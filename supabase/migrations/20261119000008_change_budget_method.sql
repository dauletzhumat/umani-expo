-- UMANI 0008: switch the budget method later (PRD BUD-3; DATABASE.md §8 change_budget_method).
--
-- Rules:
-- - Past allocations stay as they were; income after the switch uses the new weights.
-- - Presets keep an existing envelope of the same kind (e.g. Savings), so its balance carries over.
--   A custom layout keeps the envelopes it names by id (rename / new share).
-- - Envelopes left out are archived. Their balances move in one `allocation` entry to the target
--   the user picked (an index into the new layout) or, by default, to Unallocated. Envelope lines
--   stay zero-sum and R1 is untouched (no ledger lines change).
-- - Idempotent per key like every mutating RPC; the switch is recorded in budget_method_changes.

create table public.budget_method_changes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  budget_id       uuid not null,
  from_method     public.budget_method not null,
  to_method       public.budget_method not null,
  -- the allocation entry that moved removed envelopes' balances; null when nothing had to move
  entry_id        uuid,
  idempotency_key uuid not null,
  request_hash    bytea not null,
  created_at      timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (budget_id, user_id) references public.budgets (id, user_id) on delete cascade,
  foreign key (entry_id, user_id) references public.ledger_entries (id, user_id) on delete cascade
);
create index budget_method_changes_budget_idx on public.budget_method_changes (budget_id);
create index budget_method_changes_entry_idx on public.budget_method_changes (entry_id);

alter table public.budget_method_changes enable row level security;
create policy budget_method_changes_select_own on public.budget_method_changes
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.budget_method_changes from anon, authenticated;
grant select on public.budget_method_changes to authenticated;

-- Every posting RPC reads the active budget through this helper. Taking FOR SHARE on the budget
-- row makes postings wait while a method switch (FOR UPDATE below) archives envelopes, so no
-- income or expense lands in an envelope that is being removed. Shares don't block each other.
-- VOLATILE because row locks are not allowed in stable functions.
create or replace function private.active_budget(p_user uuid)
returns public.budgets
language plpgsql
volatile
set search_path = ''
as $$
declare
  b public.budgets;
begin
  select * into b from public.budgets where user_id = p_user and is_active for share;
  if not found then
    perform private.fail('no_active_budget');
  end if;
  return b;
end;
$$;

-- Preset layouts, the same as api.setup_budget and src/domain/allocation/presets.ts.
create function private.preset_layout(p_method public.budget_method)
returns table (name_key text, kind public.envelope_kind, bps int, ord int)
language sql
immutable
set search_path = ''
as $$
  select p.name_key, p.kind::public.envelope_kind, p.bps, p.ord
  from (values
    ('50_30_20', 'envelope.needs',      'needs',       5000, 0),
    ('50_30_20', 'envelope.wants',      'wants',       3000, 1),
    ('50_30_20', 'envelope.savings',    'savings',     2000, 2),
    ('80_20',    'envelope.spending',   'spending',    8000, 0),
    ('80_20',    'envelope.savings',    'savings',     2000, 1),
    ('90_10',    'envelope.spending',   'spending',    9000, 0),
    ('90_10',    'envelope.savings',    'savings',     1000, 1),
    ('70_20_10', 'envelope.living',     'living',      7000, 0),
    ('70_20_10', 'envelope.savings',    'savings',     2000, 1),
    ('70_20_10', 'envelope.debtGiving', 'debt_giving', 1000, 2)
  ) as p (method, name_key, kind, bps, ord)
  where p.method = p_method::text;
$$;

/**
 * Switches the active budget to p_method.
 *
 * p_custom (method = 'custom'): [{ "name": text, "allocation_bps": int, "kind"?: "custom"|"savings",
 *   "envelope_id"?: uuid of an active envelope to keep }], 1–12 items, names unique, total 10000.
 * p_reassign: { "<removed envelope id>": <index into the new layout> | "unallocated" }; envelopes
 *   not listed go to Unallocated.
 * Returns the budget_method_changes id.
 */
create function api.change_budget_method(
  p_method public.budget_method,
  p_idempotency_key uuid,
  p_custom jsonb default null,
  p_reassign jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  v_hash bytea;
  v_existing record;
  bud public.budgets;
  layout jsonb := '[]'::jsonb;  -- [{ord, name, name_key, kind, bps, keep}] in the new order
  item jsonb;
  idx bigint;
  n int;
  v_name text;
  v_bps numeric;
  v_kind text;
  v_keep uuid;
  total numeric := 0;
  names text[] := '{}';
  kept uuid[] := '{}';
  removed_ids uuid[];
  ids uuid[] := '{}';            -- envelope id per layout position, after writes
  v_id uuid;
  removed record;
  v_target jsonb;
  target_id uuid;
  v_entry uuid;
  v_change uuid;
  v_ord int;
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_method is null then
    perform private.fail('invalid_method');
  end if;
  v_hash := private.hash_request(
    'change_budget_method', p_method::text, coalesce(p_custom::text, ''), coalesce(p_reassign::text, '')
  );

  if p_idempotency_key is null then
    perform private.fail('idempotency_key_required');
  end if;
  perform private.lock_idempotency_key(uid, p_idempotency_key);
  select id, request_hash into v_existing
    from public.budget_method_changes where user_id = uid and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.request_hash <> v_hash then
      perform private.fail('idempotency_conflict');
    end if;
    return v_existing.id;
  end if;
  -- one key per user intent across every mutating RPC
  if exists (select 1 from public.ledger_entries where user_id = uid and idempotency_key = p_idempotency_key) then
    perform private.fail('idempotency_conflict');
  end if;

  -- one switch at a time per budget
  select * into bud from public.budgets where user_id = uid and is_active for update;
  if not found then
    perform private.fail('no_active_budget');
  end if;

  -- ---------- the new layout (no writes yet) ----------
  if p_method = 'custom' then
    if jsonb_typeof(p_custom) is distinct from 'array' then
      perform private.fail('invalid_custom_budget');
    end if;
    n := jsonb_array_length(p_custom);
    if n < 1 then perform private.fail('too_few_envelopes'); end if;
    if n > 12 then perform private.fail('too_many_envelopes'); end if;
    for item, idx in select t.value, t.ord - 1 from jsonb_array_elements(p_custom) with ordinality as t(value, ord) loop
      v_name := btrim(coalesce(item ->> 'name', ''));
      if char_length(v_name) < 1 or char_length(v_name) > 40 then
        perform private.fail('invalid_name', idx::text);
      end if;
      if lower(v_name) = any (names) then
        perform private.fail('duplicate_name', idx::text);
      end if;
      names := names || lower(v_name);
      if jsonb_typeof(item -> 'allocation_bps') is distinct from 'number' then
        perform private.fail('invalid_percentage', idx::text);
      end if;
      v_bps := (item ->> 'allocation_bps')::numeric;
      if v_bps <> trunc(v_bps) or v_bps < 1 or v_bps > 10000 then
        perform private.fail('invalid_percentage', idx::text);
      end if;
      v_keep := null;
      if item ? 'envelope_id' and jsonb_typeof(item -> 'envelope_id') <> 'null' then
        if coalesce(item ->> 'envelope_id', '') !~ uuid_re then
          perform private.fail('unknown_envelope', idx::text);
        end if;
        v_keep := (item ->> 'envelope_id')::uuid;
        if v_keep = any (kept) or not exists (
          select 1 from public.envelopes e
          where e.id = v_keep and e.user_id = uid and e.budget_id = bud.id
            and e.archived_at is null and not e.is_system
        ) then
          perform private.fail('unknown_envelope', idx::text);
        end if;
        kept := kept || v_keep;
      end if;
      -- a kept Savings envelope stays Savings unless the layout says otherwise
      v_kind := coalesce(
        item ->> 'kind',
        (select case when e.kind = 'savings' then 'savings' end from public.envelopes e where e.id = v_keep),
        'custom'
      );
      if v_kind not in ('custom', 'savings') then
        perform private.fail('invalid_kind', idx::text);
      end if;
      total := total + v_bps;
      layout := layout || jsonb_build_object(
        'ord', idx, 'name', v_name, 'name_key', null, 'kind', v_kind, 'bps', v_bps::int, 'keep', v_keep
      );
    end loop;
    if total <> 10000 then
      perform private.fail('not_100_percent', total::text);
    end if;
  else
    if p_custom is not null then
      perform private.fail('invalid_custom_budget');
    end if;
    for item in
      select jsonb_build_object('ord', p.ord, 'name', null, 'name_key', p.name_key, 'kind', p.kind::text, 'bps', p.bps, 'keep', (
        select e.id from public.envelopes e
        where e.user_id = uid and e.budget_id = bud.id and e.archived_at is null and not e.is_system
          and e.kind = p.kind
        order by e.sort_order
        limit 1
      ))
      from private.preset_layout(p_method) p
      order by p.ord
    loop
      layout := layout || item;
      if item ->> 'keep' is not null then
        kept := kept || (item ->> 'keep')::uuid;
      end if;
    end loop;
  end if;

  select coalesce(array_agg(e.id), '{}') into removed_ids
  from public.envelopes e
  where e.user_id = uid and e.budget_id = bud.id and e.archived_at is null and not e.is_system
    and not (e.id = any (kept));

  -- reassignment targets must name removed envelopes and valid layout positions
  if p_reassign is not null then
    if jsonb_typeof(p_reassign) <> 'object'
       or (select count(*) from jsonb_object_keys(p_reassign)) > coalesce(array_length(removed_ids, 1), 0) then
      perform private.fail('invalid_reassign');
    end if;
    for v_name, v_target in select key, value from jsonb_each(p_reassign) loop
      if v_name !~ uuid_re or not (v_name::uuid = any (removed_ids)) then
        perform private.fail('invalid_reassign', left(v_name, 40));
      end if;
      if not (
        v_target = '"unallocated"'::jsonb
        or (jsonb_typeof(v_target) = 'number'
            and (v_target #>> '{}')::numeric = trunc((v_target #>> '{}')::numeric)
            and (v_target #>> '{}')::numeric between 0 and jsonb_array_length(layout) - 1)
      ) then
        perform private.fail('invalid_reassign', left(v_name, 40));
      end if;
    end loop;
  end if;

  -- ---------- writes ----------
  -- free the sort_order slots (unique among active envelopes) before laying out the new order
  update public.envelopes e set sort_order = -1 - e.sort_order
  where e.user_id = uid and e.id = any (kept);
  update public.envelopes e set archived_at = now()
  where e.user_id = uid and e.id = any (removed_ids);
  -- categories must not keep an archived envelope as their default (it is offered for expenses)
  update public.categories c set default_envelope_id = null
  where c.user_id = uid and c.default_envelope_id = any (removed_ids);

  for item in select value from jsonb_array_elements(layout) order by (value ->> 'ord')::int loop
    if item ->> 'keep' is not null then
      update public.envelopes e
      set name = item ->> 'name', name_key = item ->> 'name_key',
          kind = (item ->> 'kind')::public.envelope_kind,
          allocation_bps = (item ->> 'bps')::int, sort_order = (item ->> 'ord')::int
      where e.id = (item ->> 'keep')::uuid and e.user_id = uid
      returning e.id into v_id;
    else
      insert into public.envelopes (user_id, budget_id, name, name_key, kind, allocation_bps, sort_order)
      values (uid, bud.id, item ->> 'name', item ->> 'name_key', (item ->> 'kind')::public.envelope_kind,
              (item ->> 'bps')::int, (item ->> 'ord')::int)
      returning id into v_id;
    end if;
    ids := ids || v_id;
  end loop;

  -- move what the removed envelopes held (balances can be negative after overspending, R8)
  for removed in
    select e.id, coalesce(sum(l.amount_minor), 0)::bigint as balance
    from public.envelopes e
    left join public.envelope_lines l on l.envelope_id = e.id
    where e.user_id = uid and e.id = any (removed_ids)
    group by e.id
    having coalesce(sum(l.amount_minor), 0) <> 0
    order by e.id
  loop
    v_target := p_reassign -> removed.id::text;
    if v_target is null or v_target = '"unallocated"'::jsonb then
      target_id := private.unallocated_envelope(bud.id);
    else
      -- validated above as a whole number in range; '1.0' is fine via numeric
      v_ord := ((v_target #>> '{}')::numeric)::int;
      target_id := ids[v_ord + 1];
    end if;
    if v_entry is null then
      -- the entry gets its own key: the request key lives in budget_method_changes
      v_entry := private.insert_entry(uid, 'allocation', current_date, null, null, gen_random_uuid(), v_hash);
    end if;
    perform private.add_envelope_line(v_entry, uid, removed.id, -removed.balance);
    perform private.add_envelope_line(v_entry, uid, target_id, removed.balance);
  end loop;

  insert into public.budget_method_changes
    (user_id, budget_id, from_method, to_method, entry_id, idempotency_key, request_hash)
  values (uid, bud.id, bud.method, p_method, v_entry, p_idempotency_key, v_hash)
  returning id into v_change;
  update public.budgets set method = p_method where id = bud.id;
  return v_change;
end;
$$;

revoke execute on function private.preset_layout(public.budget_method) from public, anon, authenticated;
revoke execute on function api.change_budget_method(public.budget_method, uuid, jsonb, jsonb) from public, anon;
grant execute on function api.change_budget_method(public.budget_method, uuid, jsonb, jsonb) to authenticated;
