-- UMANI 0005: write path — api.* RPCs (DATABASE.md §5a, §8). Mirrors src/domain/ledger/builders.ts.
-- api.* functions are SECURITY DEFINER with an empty search_path; they resolve the caller with
-- auth.uid(), check ownership of every referenced row and keep L1/E1/R1 inside one transaction.

-- =====================================================================
-- internal helpers
-- =====================================================================

create function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    perform private.fail('not_authenticated');
  end if;
  return v;
end;
$$;

create function private.to_uuid(p text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  return p::uuid;
exception when invalid_text_representation then
  perform private.fail('invalid_input');
  return null;
end;
$$;

-- Only ISO dates (YYYY-MM-DD); no DateStyle dependence, no 'today'/'infinity'.
create function private.to_date(p text)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if p is null then
    return null;
  end if;
  if p !~ '^\d{4}-\d{2}-\d{2}$' then
    perform private.fail('invalid_date');
  end if;
  return p::date;
exception when invalid_datetime_format or datetime_field_overflow then
  perform private.fail('invalid_date');
  return null;
end;
$$;

-- Canonical request fingerprint for idempotency (DATABASE.md §3 request_hash). Hashing the JSON
-- array keeps it injective (no separator or NULL-marker collisions). Oversized inputs are
-- rejected before hashing.
create function private.hash_request(variadic p_parts text[])
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(p_parts) s where length(s) > 4000) then
    perform private.fail('input_too_long');
  end if;
  return sha256(convert_to(to_jsonb(p_parts)::text, 'UTF8'));
end;
$$;

-- Serialises concurrent requests that use the same idempotency key (advisory lock until commit).
create function private.lock_idempotency_key(p_user uuid, p_key uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_key::text, 0));
$$;

-- Same key + same request → existing entry id; same key + different request → idempotency_conflict.
-- VOLATILE so the lookup after the lock sees rows committed by a concurrent retry.
create function private.find_idempotent(p_user uuid, p_key uuid, p_hash bytea)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
  v_hash bytea;
begin
  if p_key is null then
    perform private.fail('idempotency_key_required');
  end if;
  perform private.lock_idempotency_key(p_user, p_key);
  select id, request_hash into v_id, v_hash
  from public.ledger_entries where user_id = p_user and idempotency_key = p_key;
  if v_id is null then
    return null;
  end if;
  if v_hash <> p_hash then
    perform private.fail('idempotency_conflict');
  end if;
  return v_id;
end;
$$;

create function private.active_budget(p_user uuid)
returns public.budgets
language plpgsql
stable
set search_path = ''
as $$
declare
  b public.budgets;
begin
  select * into b from public.budgets where user_id = p_user and is_active;
  if not found then
    perform private.fail('no_active_budget');
  end if;
  return b;
end;
$$;

-- Locks the user's account row so concurrent writes to one account serialise.
create function private.lock_account(p_user uuid, p_account uuid)
returns public.accounts
language plpgsql
set search_path = ''
as $$
declare
  a public.accounts;
begin
  select * into a from public.accounts
  where id = p_account and user_id = p_user and kind <> 'system'
  for update;
  if not found then
    perform private.fail('account_not_found');
  end if;
  if a.archived_at is not null then
    perform private.fail('account_archived');
  end if;
  return a;
end;
$$;

create function private.account_position(p_account uuid, out balance bigint, out book bigint)
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount_minor), 0)::bigint, coalesce(sum(base_amount_minor), 0)::bigint
  from public.ledger_lines where account_id = p_account;
$$;

create function private.require_envelope(p_user uuid, p_budget uuid, p_envelope uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_envelope is null or not exists (
    select 1 from public.envelopes
    where id = p_envelope and user_id = p_user and budget_id = p_budget and archived_at is null
  ) then
    perform private.fail('unknown_envelope');
  end if;
end;
$$;

create function private.unallocated_envelope(p_budget uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid;
begin
  select id into v from public.envelopes where budget_id = p_budget and kind = 'unallocated';
  if v is null then
    perform private.fail('missing_unallocated');
  end if;
  return v;
end;
$$;

create function private.require_category(p_user uuid, p_category uuid, p_kind public.category_kind)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_category is not null and not exists (
    select 1 from public.categories
    where id = p_category and user_id = p_user and kind = p_kind and archived_at is null
  ) then
    perform private.fail('unknown_category');
  end if;
end;
$$;

-- Hidden counterparty account per user, role and currency (created on first use).
create function private.system_account(p_user uuid, p_role public.system_role, p_currency char(3))
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v uuid;
begin
  insert into public.accounts (user_id, name, kind, system_role, currency, include_in_budget)
  values (p_user, 'system:' || p_role::text || ':' || p_currency, 'system', p_role, p_currency, false)
  on conflict (user_id, system_role, currency) where kind = 'system' do nothing;

  select id into v from public.accounts
  where user_id = p_user and kind = 'system' and system_role = p_role and currency = p_currency;
  return v;
end;
$$;

create function private.insert_entry(
  p_user uuid, p_kind public.entry_kind, p_on date, p_category uuid, p_note text,
  p_key uuid, p_hash bytea, p_reverses uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_on is null or p_on < date '2000-01-01' or p_on > current_date + 366 then
    perform private.fail('invalid_date');
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    perform private.fail('note_too_long');
  end if;
  insert into public.ledger_entries
    (user_id, kind, occurred_on, category_id, note, reverses_entry_id, idempotency_key, request_hash)
  values (p_user, p_kind, p_on, p_category, nullif(btrim(p_note), ''), p_reverses, p_key, p_hash)
  returning id into v;
  return v;
end;
$$;

create function private.add_line(p_entry uuid, p_user uuid, p_account uuid, p_amount bigint, p_base bigint)
returns void
language sql
set search_path = ''
as $$
  insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
  select p_entry, p_user, a.id, p_amount, a.currency, p_base from public.accounts a where a.id = p_account;
$$;

create function private.add_system_line(
  p_entry uuid, p_user uuid, p_role public.system_role, p_amount bigint, p_currency char(3)
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
  values (p_entry, p_user, private.system_account(p_user, p_role, p_currency), p_amount, p_currency, null);
end;
$$;

-- Envelope lines must be non-zero, so zero amounts are skipped.
create function private.add_envelope_line(
  p_entry uuid, p_user uuid, p_envelope uuid, p_amount bigint, p_rate numeric default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_amount <> 0 then
    insert into public.envelope_lines (entry_id, user_id, envelope_id, amount_minor, fx_rate)
    values (p_entry, p_user, p_envelope, p_amount, p_rate);
  end if;
end;
$$;

-- Splits a base amount over the active, non-system envelopes by method weights (INC-2).
create function private.allocate_to_budget(p_budget uuid, p_total bigint)
returns table (envelope_id uuid, amount bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  ids uuid[];
  weights int[];
  parts bigint[];
begin
  select array_agg(e.id order by e.sort_order), array_agg(e.allocation_bps order by e.sort_order)
  into ids, weights
  from public.envelopes e
  where e.budget_id = p_budget and e.kind <> 'unallocated' and e.archived_at is null;

  if ids is null or (select sum(w) from unnest(weights) w) <> 10000 then
    perform private.fail('invalid_budget');
  end if;

  parts := private.allocate_bps(p_total, weights);
  return query
    select ids[i], parts[i] from generate_subscripts(ids, 1) as i where parts[i] > 0 order by i;
end;
$$;

-- =====================================================================
-- posting functions (one per operation; api.* wrappers and amend_entry call these)
-- =====================================================================

create function private.post_income(
  p_user uuid, p_account uuid, p_amount text, p_on date, p_category uuid,
  p_allocation jsonb, p_rate text, p_note text, p_key uuid, p_hash bytea
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  acc public.accounts;
  bud public.budgets;
  amt bigint;
  rate numeric;
  base bigint;
  v_entry uuid;
  v_mode text;
  part jsonb;
  part_env uuid;
  part_amt bigint;
  assigned bigint := 0;
  seen uuid[] := '{}';
  r record;
begin
  v_existing := private.find_idempotent(p_user, p_key, p_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  acc := private.lock_account(p_user, p_account);
  bud := private.active_budget(p_user);
  amt := private.parse_amount(p_amount);
  if amt <= 0 then
    perform private.fail('non_positive_amount');
  end if;
  perform private.require_category(p_user, p_category, 'income');
  rate := private.parse_rate(p_rate);
  base := private.book_in(amt, acc.currency, bud.base_currency, rate);

  v_entry := private.insert_entry(p_user, 'income', p_on, p_category, p_note, p_key, p_hash);
  perform private.add_line(v_entry, p_user, acc.id, amt, base);
  perform private.add_system_line(v_entry, p_user, 'income', -amt, acc.currency);

  if acc.include_in_budget and base > 0 then
    if acc.currency = bud.base_currency then
      rate := null; -- the rate is recorded only for foreign-currency income
    end if;
    v_mode := coalesce(p_allocation ->> 'mode', 'auto');

    if v_mode = 'auto' then
      for r in select * from private.allocate_to_budget(bud.id, base) loop
        perform private.add_envelope_line(v_entry, p_user, r.envelope_id, r.amount, rate);
      end loop;

    elsif v_mode = 'manual' then
      if jsonb_typeof(p_allocation -> 'parts') is distinct from 'array' then
        perform private.fail('invalid_allocation');
      end if;
      for part in select value from jsonb_array_elements(p_allocation -> 'parts') loop
        select e.id into part_env from public.envelopes e
        where e.id = private.to_uuid(part ->> 'envelope_id') and e.user_id = p_user and e.budget_id = bud.id
          and e.archived_at is null and e.kind <> 'unallocated';
        if part_env is null then
          perform private.fail('unknown_envelope');
        end if;
        if part_env = any (seen) then
          perform private.fail('duplicate_envelope');
        end if;
        part_amt := private.parse_amount(part ->> 'amount');
        if part_amt < 0 then
          perform private.fail('negative_part');
        end if;
        seen := seen || part_env;
        assigned := assigned + part_amt;
        perform private.add_envelope_line(v_entry, p_user, part_env, part_amt, rate);
      end loop;
      if assigned > base then
        perform private.fail('exceeds_total');
      end if;
      if base > assigned then
        perform private.add_envelope_line(
          v_entry, p_user, private.unallocated_envelope(bud.id), base - assigned, rate
        );
      end if;

    else
      perform private.fail('invalid_allocation');
    end if;
  end if;

  return v_entry;
end;
$$;

create function private.post_expense(
  p_user uuid, p_account uuid, p_envelope uuid, p_amount text, p_on date, p_category uuid,
  p_rate text, p_note text, p_key uuid, p_hash bytea
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  acc public.accounts;
  bud public.budgets;
  amt bigint;
  v_balance bigint;
  v_book bigint;
  base bigint;
  v_entry uuid;
begin
  v_existing := private.find_idempotent(p_user, p_key, p_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  acc := private.lock_account(p_user, p_account);
  bud := private.active_budget(p_user);
  amt := private.parse_amount(p_amount);
  if amt <= 0 then
    perform private.fail('non_positive_amount');
  end if;
  perform private.require_category(p_user, p_category, 'expense');
  if acc.include_in_budget then
    if p_envelope is null then
      perform private.fail('envelope_required');
    end if;
    perform private.require_envelope(p_user, bud.id, p_envelope);
  end if;

  select * into v_balance, v_book from private.account_position(acc.id);
  base := private.book_out(v_balance, v_book, amt, acc.currency, bud.base_currency, private.parse_rate(p_rate));

  v_entry := private.insert_entry(p_user, 'expense', p_on, p_category, p_note, p_key, p_hash);
  perform private.add_line(v_entry, p_user, acc.id, -amt, -base);
  perform private.add_system_line(v_entry, p_user, 'expense', amt, acc.currency);
  if acc.include_in_budget then
    perform private.add_envelope_line(v_entry, p_user, p_envelope, -base);
  end if;
  return v_entry;
end;
$$;

create function private.post_transfer(
  p_user uuid, p_from uuid, p_to uuid, p_sent text, p_received text, p_envelope uuid,
  p_on date, p_rate text, p_note text, p_key uuid, p_hash bytea
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  src public.accounts;
  dst public.accounts;
  bud public.budgets;
  sent bigint;
  received bigint;
  v_balance bigint;
  v_book bigint;
  base_out bigint;
  base_in bigint;
  fx_result bigint;
  target uuid;
  v_entry uuid;
begin
  v_existing := private.find_idempotent(p_user, p_key, p_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  if p_from = p_to then
    perform private.fail('same_account');
  end if;
  -- lock in a stable order to avoid deadlocks between opposite transfers
  if p_from < p_to then
    src := private.lock_account(p_user, p_from);
    dst := private.lock_account(p_user, p_to);
  else
    dst := private.lock_account(p_user, p_to);
    src := private.lock_account(p_user, p_from);
  end if;
  bud := private.active_budget(p_user);

  sent := private.parse_amount(p_sent);
  received := private.parse_amount(p_received);
  if sent <= 0 or received <= 0 then
    perform private.fail('non_positive_amount');
  end if;
  if src.currency = dst.currency and sent <> received then
    perform private.fail('amount_mismatch');
  end if;

  select * into v_balance, v_book from private.account_position(src.id);
  base_out := private.book_out(v_balance, v_book, sent, src.currency, bud.base_currency, private.parse_rate(p_rate));
  base_in := case when dst.currency = bud.base_currency then received else base_out end;
  fx_result := base_in - base_out;

  v_entry := private.insert_entry(p_user, 'transfer', p_on, null, p_note, p_key, p_hash);
  perform private.add_line(v_entry, p_user, src.id, -sent, -base_out);
  perform private.add_line(v_entry, p_user, dst.id, received, base_in);
  if src.currency <> dst.currency then
    perform private.add_system_line(v_entry, p_user, 'fx_clearing', sent, src.currency);
    perform private.add_system_line(v_entry, p_user, 'fx_clearing', -received, dst.currency);
  end if;

  if src.include_in_budget and dst.include_in_budget then
    if fx_result <> 0 then
      perform private.add_envelope_line(v_entry, p_user, private.unallocated_envelope(bud.id), fx_result);
    end if;
  elsif src.include_in_budget or dst.include_in_budget then
    if p_envelope is null then
      target := private.unallocated_envelope(bud.id);
    else
      perform private.require_envelope(p_user, bud.id, p_envelope);
      target := p_envelope;
    end if;
    perform private.add_envelope_line(
      v_entry, p_user, target, case when src.include_in_budget then -base_out else base_in end
    );
  end if;
  return v_entry;
end;
$$;

create function private.post_reallocation(
  p_user uuid, p_from uuid, p_to uuid, p_amount text, p_on date, p_key uuid, p_hash bytea
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  bud public.budgets;
  amt bigint;
  v_entry uuid;
begin
  v_existing := private.find_idempotent(p_user, p_key, p_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  bud := private.active_budget(p_user);
  amt := private.parse_amount(p_amount);
  if amt <= 0 then
    perform private.fail('non_positive_amount');
  end if;
  if p_from = p_to then
    perform private.fail('same_envelope');
  end if;
  perform private.require_envelope(p_user, bud.id, p_from);
  perform private.require_envelope(p_user, bud.id, p_to);

  v_entry := private.insert_entry(p_user, 'allocation', p_on, null, null, p_key, p_hash);
  perform private.add_envelope_line(v_entry, p_user, p_from, -amt);
  perform private.add_envelope_line(v_entry, p_user, p_to, amt);
  return v_entry;
end;
$$;

create function private.post_adjustment(
  p_user uuid, p_account uuid, p_target text, p_rate text, p_on date, p_key uuid, p_hash bytea
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  acc public.accounts;
  bud public.budgets;
  target bigint;
  v_balance bigint;
  v_book bigint;
  diff bigint;
  rate numeric;
  base bigint;
  v_entry uuid;
begin
  v_existing := private.find_idempotent(p_user, p_key, p_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  acc := private.lock_account(p_user, p_account);
  bud := private.active_budget(p_user);
  target := private.parse_amount(p_target);
  select * into v_balance, v_book from private.account_position(acc.id);
  diff := target - v_balance;
  if diff = 0 then
    perform private.fail('no_change');
  end if;
  if abs(diff) > 1000000000000000 then
    perform private.fail('out_of_range');
  end if;

  rate := private.parse_rate(p_rate);
  if diff > 0 then
    base := private.book_in(diff, acc.currency, bud.base_currency, rate);
  else
    base := -private.book_out(v_balance, v_book, -diff, acc.currency, bud.base_currency, rate);
  end if;

  v_entry := private.insert_entry(p_user, 'adjustment', p_on, null, null, p_key, p_hash);
  perform private.add_line(v_entry, p_user, acc.id, diff, base);
  perform private.add_system_line(v_entry, p_user, 'adjustment', -diff, acc.currency);
  if acc.include_in_budget and base <> 0 then
    perform private.add_envelope_line(v_entry, p_user, private.unallocated_envelope(bud.id), base);
  end if;
  return v_entry;
end;
$$;

create function private.post_revaluation(
  p_user uuid, p_account uuid, p_rate text, p_on date, p_key uuid, p_hash bytea
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  acc public.accounts;
  bud public.budgets;
  rate numeric;
  v_balance bigint;
  v_book bigint;
  delta bigint;
  v_entry uuid;
begin
  v_existing := private.find_idempotent(p_user, p_key, p_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  acc := private.lock_account(p_user, p_account);
  bud := private.active_budget(p_user);
  if acc.currency = bud.base_currency then
    perform private.fail('not_foreign_currency');
  end if;
  rate := private.parse_rate(p_rate);
  if rate is null then
    perform private.fail('invalid_rate');
  end if;

  select * into v_balance, v_book from private.account_position(acc.id);
  delta := private.convert(v_balance, acc.currency, rate, bud.base_currency) - v_book;
  if delta = 0 then
    perform private.fail('no_change');
  end if;
  if abs(delta) > 1000000000000000 then
    perform private.fail('out_of_range');
  end if;

  v_entry := private.insert_entry(p_user, 'fx_revaluation', p_on, null, null, p_key, p_hash);
  perform private.add_line(v_entry, p_user, acc.id, 0, delta);
  if acc.include_in_budget then
    perform private.add_envelope_line(v_entry, p_user, private.unallocated_envelope(bud.id), delta);
  end if;
  return v_entry;
end;
$$;

-- Reversal (R5): negates every line, keeps the original date. At most one per entry.
create function private.post_reversal(p_user uuid, p_entry uuid, p_key uuid, p_hash bytea)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid;
  orig public.ledger_entries;
  v_entry uuid;
begin
  v_existing := private.find_idempotent(p_user, p_key, p_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into orig from public.ledger_entries where id = p_entry and user_id = p_user for update;
  if not found then
    perform private.fail('entry_not_found');
  end if;
  if orig.kind = 'reversal' then
    perform private.fail('cannot_reverse_reversal');
  end if;
  if exists (select 1 from public.ledger_entries where reverses_entry_id = orig.id) then
    perform private.fail('already_reversed');
  end if;
  -- Lock the affected accounts (archived ones included) so concurrent postings read a
  -- consistent balance/book pair.
  perform 1 from public.accounts
  where id in (select account_id from public.ledger_lines where entry_id = orig.id) and kind <> 'system'
  order by id
  for update;

  v_entry := private.insert_entry(
    p_user, 'reversal', orig.occurred_on, orig.category_id, orig.note, p_key, p_hash, orig.id
  );
  insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
  select v_entry, l.user_id, l.account_id, -l.amount_minor, l.currency, -l.base_amount_minor
  from public.ledger_lines l where l.entry_id = orig.id;
  insert into public.envelope_lines (entry_id, user_id, envelope_id, amount_minor, fx_rate)
  select v_entry, l.user_id, l.envelope_id, -l.amount_minor, l.fx_rate
  from public.envelope_lines l where l.entry_id = orig.id;
  return v_entry;
end;
$$;

-- =====================================================================
-- api: budget and accounts
-- =====================================================================

create function api.setup_budget(
  p_method public.budget_method, p_base_currency char(3), p_custom jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  v_budget uuid;
  n int;
  item jsonb;
  idx bigint;
  v_name text;
  v_bps numeric;
  v_kind text;
  total numeric := 0;
  names text[] := '{}';
begin
  if p_method is null then
    perform private.fail('invalid_method');
  end if;
  -- serialise concurrent setups for the same user
  perform pg_advisory_xact_lock(hashtextextended('setup_budget:' || uid::text, 0));
  if exists (select 1 from public.budgets where user_id = uid and is_active) then
    perform private.fail('budget_exists');
  end if;
  if p_base_currency is null or not exists (select 1 from public.currencies where code = p_base_currency) then
    perform private.fail('unknown_currency');
  end if;

  insert into public.budgets (user_id, base_currency, method)
  values (uid, p_base_currency, p_method)
  returning id into v_budget;

  if p_method = 'custom' then
    -- PRD BUD-2 (src/domain/allocation/custom.ts)
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

      v_kind := coalesce(item ->> 'kind', 'custom');
      if v_kind not in ('custom', 'savings') then
        perform private.fail('invalid_kind', idx::text);
      end if;

      total := total + v_bps;
      insert into public.envelopes (user_id, budget_id, name, kind, allocation_bps, sort_order)
      values (uid, v_budget, v_name, v_kind::public.envelope_kind, v_bps::int, idx::int);
    end loop;

    if total <> 10000 then
      perform private.fail('not_100_percent', total::text);
    end if;
  else
    -- PRD BUD-1 (src/domain/allocation/presets.ts)
    insert into public.envelopes (user_id, budget_id, name_key, kind, allocation_bps, sort_order)
    select uid, v_budget, p.name_key, p.kind::public.envelope_kind, p.bps, p.ord
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
  end if;

  insert into public.envelopes (user_id, budget_id, name_key, kind, allocation_bps, sort_order, is_system)
  values (uid, v_budget, 'envelope.unallocated', 'unallocated', 0, 1000, true);

  -- Default categories (once per user). Default envelopes per category come with the expenses milestone.
  if not exists (select 1 from public.categories where user_id = uid) then
    insert into public.categories (user_id, kind, name_key)
    select uid, c.kind::public.category_kind, c.name_key
    from (values
      ('expense', 'category.groceries'), ('expense', 'category.transport'), ('expense', 'category.housing'),
      ('expense', 'category.utilities'), ('expense', 'category.health'), ('expense', 'category.restaurants'),
      ('expense', 'category.entertainment'), ('expense', 'category.shopping'), ('expense', 'category.education'),
      ('expense', 'category.otherExpense'),
      ('income', 'category.salary'), ('income', 'category.freelance'), ('income', 'category.gift'),
      ('income', 'category.otherIncome')
    ) as c (kind, name_key);
  end if;

  update public.profiles set base_currency = p_base_currency where id = uid;
  return v_budget;
end;
$$;

create function api.create_account(
  p_name text,
  p_kind public.account_kind,
  p_currency char(3),
  p_idempotency_key uuid,
  p_opening_balance text default null,
  p_opening_rate text default null,
  p_opening_on date default null,
  p_include_in_budget boolean default true,
  p_linked_envelope_id uuid default null,
  p_institution text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  v_hash bytea;
  v_account uuid;
  v_existing_hash bytea;
  bud public.budgets;
  v_include boolean := coalesce(p_include_in_budget, true);
  amt bigint;
  base bigint;
  v_entry uuid;
begin
  if p_idempotency_key is null then
    perform private.fail('idempotency_key_required');
  end if;
  v_hash := private.hash_request(
    'create_account', p_name, p_kind::text, p_currency, p_opening_balance, p_opening_rate,
    p_opening_on::text, v_include::text, p_linked_envelope_id::text, p_institution
  );
  perform private.lock_idempotency_key(uid, p_idempotency_key);
  select id, request_hash into v_account, v_existing_hash
  from public.accounts where user_id = uid and idempotency_key = p_idempotency_key;
  if v_account is not null then
    if v_existing_hash <> v_hash then
      perform private.fail('idempotency_conflict');
    end if;
    return v_account;
  end if;

  if p_kind is null or p_kind = 'system' then
    perform private.fail('invalid_kind');
  end if;
  if p_currency is null or not exists (select 1 from public.currencies where code = p_currency) then
    perform private.fail('unknown_currency');
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then
    perform private.fail('invalid_name');
  end if;
  if p_institution is not null and char_length(p_institution) > 100 then
    perform private.fail('invalid_institution');
  end if;

  -- quota: a personal-finance user has no reason for more (abuse / storage guard)
  if (select count(*) from public.accounts where user_id = uid and kind <> 'system') >= 50 then
    perform private.fail('account_limit');
  end if;

  bud := private.active_budget(uid);
  if p_linked_envelope_id is not null then
    perform private.require_envelope(uid, bud.id, p_linked_envelope_id);
  end if;

  insert into public.accounts
    (user_id, name, kind, currency, institution, linked_envelope_id, include_in_budget, idempotency_key, request_hash)
  values
    (uid, btrim(p_name), p_kind, p_currency, nullif(btrim(p_institution), ''), p_linked_envelope_id, v_include,
     p_idempotency_key, v_hash)
  returning id into v_account;

  if p_opening_balance is not null then
    amt := private.parse_amount(p_opening_balance);
    if amt <> 0 then
      base := private.book_in(abs(amt), p_currency, bud.base_currency, private.parse_rate(p_opening_rate));
      if amt < 0 then
        base := -base;
      end if;
      v_entry := private.insert_entry(
        uid, 'opening_balance', coalesce(p_opening_on, current_date), null, null,
        md5(p_idempotency_key::text || ':opening')::uuid, v_hash
      );
      perform private.add_line(v_entry, uid, v_account, amt, base);
      perform private.add_system_line(v_entry, uid, 'opening_balance', -amt, p_currency);
      if v_include and base <> 0 then
        perform private.add_envelope_line(v_entry, uid, private.unallocated_envelope(bud.id), base);
      end if;
    end if;
  end if;

  return v_account;
end;
$$;

create function api.archive_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  update public.accounts set archived_at = now()
  where id = p_account_id and user_id = uid and kind <> 'system' and archived_at is null;
  if not found then
    perform private.fail('account_not_found');
  end if;
end;
$$;

-- =====================================================================
-- api: ledger operations (thin wrappers: resolve the user, fingerprint the request)
-- =====================================================================

create function api.record_income(
  p_account_id uuid, p_amount text, p_occurred_on date, p_idempotency_key uuid,
  p_category_id uuid default null, p_allocation jsonb default null,
  p_fx_rate text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  return private.post_income(
    uid, p_account_id, p_amount, p_occurred_on, p_category_id, p_allocation, p_fx_rate, p_note,
    p_idempotency_key,
    private.hash_request('record_income', p_account_id::text, p_amount, p_occurred_on::text,
                         p_category_id::text, p_allocation::text, p_fx_rate, p_note)
  );
end;
$$;

create function api.record_expense(
  p_account_id uuid, p_amount text, p_occurred_on date, p_idempotency_key uuid,
  p_envelope_id uuid default null, p_category_id uuid default null,
  p_fx_rate text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  return private.post_expense(
    uid, p_account_id, p_envelope_id, p_amount, p_occurred_on, p_category_id, p_fx_rate, p_note,
    p_idempotency_key,
    private.hash_request('record_expense', p_account_id::text, p_envelope_id::text, p_amount,
                         p_occurred_on::text, p_category_id::text, p_fx_rate, p_note)
  );
end;
$$;

create function api.record_transfer(
  p_from_account_id uuid, p_to_account_id uuid, p_amount_from text, p_amount_to text,
  p_occurred_on date, p_idempotency_key uuid,
  p_envelope_id uuid default null, p_fx_rate text default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  return private.post_transfer(
    uid, p_from_account_id, p_to_account_id, p_amount_from, p_amount_to, p_envelope_id,
    p_occurred_on, p_fx_rate, p_note, p_idempotency_key,
    private.hash_request('record_transfer', p_from_account_id::text, p_to_account_id::text, p_amount_from,
                         p_amount_to, p_envelope_id::text, p_occurred_on::text, p_fx_rate, p_note)
  );
end;
$$;

create function api.reallocate(
  p_from_envelope_id uuid, p_to_envelope_id uuid, p_amount text, p_occurred_on date, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  return private.post_reallocation(
    uid, p_from_envelope_id, p_to_envelope_id, p_amount, p_occurred_on, p_idempotency_key,
    private.hash_request('reallocate', p_from_envelope_id::text, p_to_envelope_id::text, p_amount,
                         p_occurred_on::text)
  );
end;
$$;

create function api.record_adjustment(
  p_account_id uuid, p_target_balance text, p_occurred_on date, p_idempotency_key uuid,
  p_fx_rate text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  return private.post_adjustment(
    uid, p_account_id, p_target_balance, p_fx_rate, p_occurred_on, p_idempotency_key,
    private.hash_request('record_adjustment', p_account_id::text, p_target_balance, p_occurred_on::text, p_fx_rate)
  );
end;
$$;

create function api.record_revaluation(
  p_account_id uuid, p_rate text, p_occurred_on date, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  return private.post_revaluation(
    uid, p_account_id, p_rate, p_occurred_on, p_idempotency_key,
    private.hash_request('record_revaluation', p_account_id::text, p_rate, p_occurred_on::text)
  );
end;
$$;

create function api.reverse_entry(p_entry_id uuid, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  return private.post_reversal(
    uid, p_entry_id, p_idempotency_key, private.hash_request('reverse_entry', p_entry_id::text)
  );
end;
$$;

-- Edit = reversal + new entry in one transaction (PRD INC-5, EXP-5). Supports income, expense
-- and transfer. p_new = {"kind": ..., same fields as the record_* RPC without the p_ prefix}.
create function api.amend_entry(p_entry_id uuid, p_new jsonb, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  v_hash bytea := private.hash_request('amend_entry', p_entry_id::text, p_new::text);
  v_new_key uuid;
  v_new_hash bytea := private.hash_request('amend_entry:new', p_new::text);
  orig_kind public.entry_kind;
begin
  if p_idempotency_key is null then
    perform private.fail('idempotency_key_required');
  end if;
  v_new_key := md5(p_idempotency_key::text || ':amend')::uuid;

  if private.find_idempotent(uid, p_idempotency_key, v_hash) is not null then
    return (select id from public.ledger_entries where user_id = uid and idempotency_key = v_new_key);
  end if;

  select kind into orig_kind from public.ledger_entries where id = p_entry_id and user_id = uid;
  if orig_kind is null then
    perform private.fail('entry_not_found');
  end if;
  if orig_kind not in ('income', 'expense', 'transfer') then
    perform private.fail('cannot_amend');
  end if;

  perform private.post_reversal(uid, p_entry_id, p_idempotency_key, v_hash);

  case p_new ->> 'kind'
    when 'income' then
      return private.post_income(
        uid, private.to_uuid(p_new ->> 'account_id'), p_new ->> 'amount', private.to_date(p_new ->> 'occurred_on'),
        private.to_uuid(p_new ->> 'category_id'), p_new -> 'allocation', p_new ->> 'fx_rate', p_new ->> 'note',
        v_new_key, v_new_hash
      );
    when 'expense' then
      return private.post_expense(
        uid, private.to_uuid(p_new ->> 'account_id'), private.to_uuid(p_new ->> 'envelope_id'), p_new ->> 'amount',
        private.to_date(p_new ->> 'occurred_on'), private.to_uuid(p_new ->> 'category_id'), p_new ->> 'fx_rate',
        p_new ->> 'note', v_new_key, v_new_hash
      );
    when 'transfer' then
      return private.post_transfer(
        uid, private.to_uuid(p_new ->> 'from_account_id'), private.to_uuid(p_new ->> 'to_account_id'),
        p_new ->> 'amount_from', p_new ->> 'amount_to', private.to_uuid(p_new ->> 'envelope_id'),
        private.to_date(p_new ->> 'occurred_on'), p_new ->> 'fx_rate', p_new ->> 'note', v_new_key, v_new_hash
      );
    else
      perform private.fail('invalid_amend');
  end case;
  return null;
end;
$$;

-- AI consent is a record of consent, so it is written with server time only (PRD AI-5).
create function api.set_ai_consent(p_consent boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  v timestamptz := case when coalesce(p_consent, false) then now() end;
begin
  update public.profiles set ai_consent_at = v where id = uid;
  return v;
end;
$$;

-- =====================================================================
-- privileges for user-facing RPCs
-- =====================================================================
revoke execute on all functions in schema api from public, anon;
grant execute on all functions in schema api to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.purge_user(uuid) to service_role;

-- =====================================================================
-- service-role only: account deletion entry point for the delete-account Edge Function
-- (defined after the blanket grant above so authenticated never receives it)
-- =====================================================================
create function api.purge_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform private.fail('forbidden');
  end if;
  if p_user_id is null then
    perform private.fail('invalid_input');
  end if;
  perform private.purge_user(p_user_id);
end;
$$;

revoke execute on function api.purge_account(uuid) from public, anon, authenticated;
grant execute on function api.purge_account(uuid) to service_role;
