-- UMANI 0009: categories, monthly limits and the transaction history (PRD EXP-2, EXP-4, EXP-5;
-- DATABASE.md §8 create_category / set_limit). Expenses themselves use api.record_expense (M1b).

-- ---------- categories ----------
alter table public.categories
  add column idempotency_key uuid,
  add column request_hash bytea;
create unique index categories_user_idempotency on public.categories (user_id, idempotency_key)
  where idempotency_key is not null;

-- An envelope expenses can come out of: active, in the active budget, not Unallocated.
create function private.require_spend_envelope(p_user uuid, p_budget uuid, p_envelope uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_envelope is null or not exists (
    select 1 from public.envelopes
    where id = p_envelope and user_id = p_user and budget_id = p_budget
      and archived_at is null and kind <> 'unallocated'
  ) then
    perform private.fail('unknown_envelope');
  end if;
end;
$$;

-- Serialises a user's category or limit changes so name uniqueness and the count caps hold
-- under concurrent calls (check-then-insert would race otherwise).
create function private.lock_user_scope(p_user uuid, p_scope text)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_scope, 0));
$$;

/**
 * A custom category (EXP-2). Expense categories may name a default envelope for quick entry.
 * Names are unique per kind among active custom names; seeded defaults are localised (name_key)
 * and not compared, so the UI warns about a custom name equal to a default's translation.
 */
create function api.create_category(
  p_kind public.category_kind,
  p_name text,
  p_idempotency_key uuid,
  p_default_envelope_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_hash bytea;
  v_existing record;
  bud public.budgets;
  v_id uuid;
begin
  if p_kind is null then
    perform private.fail('invalid_kind');
  end if;
  v_hash := private.hash_request('create_category', p_kind::text, v_name, coalesce(p_default_envelope_id::text, ''));
  if p_idempotency_key is null then
    perform private.fail('idempotency_key_required');
  end if;
  perform private.lock_idempotency_key(uid, p_idempotency_key);
  perform private.lock_user_scope(uid, 'categories');
  select id, request_hash into v_existing
    from public.categories where user_id = uid and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.request_hash <> v_hash then
      perform private.fail('idempotency_conflict');
    end if;
    return v_existing.id;
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    perform private.fail('invalid_name');
  end if;
  if exists (
    select 1 from public.categories c
    where c.user_id = uid and c.kind = p_kind and c.archived_at is null and lower(c.name) = lower(v_name)
  ) then
    perform private.fail('duplicate_name');
  end if;
  if (select count(*) from public.categories c where c.user_id = uid and c.archived_at is null) >= 100 then
    perform private.fail('category_limit');
  end if;
  if p_default_envelope_id is not null then
    if p_kind <> 'expense' then
      perform private.fail('invalid_input');
    end if;
    bud := private.active_budget(uid);
    perform private.require_spend_envelope(uid, bud.id, p_default_envelope_id);
  end if;

  insert into public.categories (user_id, kind, name, default_envelope_id, idempotency_key, request_hash)
  values (uid, p_kind, v_name, p_default_envelope_id, p_idempotency_key, v_hash)
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Rename a category and/or change its default envelope. A rename replaces the localised default
 * name (name_key) with the user's name. Idempotent: the same call twice leaves the same row.
 */
create function api.update_category(
  p_category_id uuid,
  p_name text default null,
  p_default_envelope_id uuid default null,
  p_clear_default boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  cat public.categories;
  v_name text;
  bud public.budgets;
begin
  perform private.lock_user_scope(uid, 'categories');
  select * into cat from public.categories
  where id = p_category_id and user_id = uid and archived_at is null
  for update;
  if not found then
    perform private.fail('unknown_category');
  end if;
  if p_clear_default and p_default_envelope_id is not null then
    perform private.fail('invalid_input');
  end if;
  if p_name is not null then
    v_name := btrim(p_name);
    if char_length(v_name) < 1 or char_length(v_name) > 40 then
      perform private.fail('invalid_name');
    end if;
    if exists (
      select 1 from public.categories c
      where c.user_id = uid and c.kind = cat.kind and c.archived_at is null and c.id <> cat.id
        and lower(c.name) = lower(v_name)
    ) then
      perform private.fail('duplicate_name');
    end if;
    update public.categories set name = v_name, name_key = null where id = cat.id;
  end if;
  if p_default_envelope_id is not null then
    if cat.kind <> 'expense' then
      perform private.fail('invalid_input');
    end if;
    bud := private.active_budget(uid);
    perform private.require_spend_envelope(uid, bud.id, p_default_envelope_id);
    update public.categories set default_envelope_id = p_default_envelope_id where id = cat.id;
  elsif p_clear_default then
    update public.categories set default_envelope_id = null where id = cat.id;
  end if;
end;
$$;

/** Hide a category from pickers; past entries keep pointing at it. Archiving twice is a no-op. */
create function api.archive_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  update public.categories set archived_at = coalesce(archived_at, now())
  where id = p_category_id and user_id = uid;
  if not found then
    perform private.fail('unknown_category');
  end if;
end;
$$;

-- ---------- limits (EXP-4) ----------
-- One limit per target and period; period_month null = every month, a date = that month only.
create unique index limits_one_per_target_period on public.limits
  (user_id, coalesce(envelope_id, category_id), coalesce(period_month, date '0001-01-01'));

/**
 * Set (or change) a monthly limit for an envelope or an expense category. An upsert, so a retry
 * is harmless. p_period_month null = every month; the first day of a month = only that month
 * (overrides the recurring limit then).
 */
create function api.set_limit(
  p_limit text,
  p_envelope_id uuid default null,
  p_category_id uuid default null,
  p_period_month date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  amt bigint;
  bud public.budgets;
  v_id uuid;
begin
  if num_nonnulls(p_envelope_id, p_category_id) <> 1 then
    perform private.fail('invalid_input');
  end if;
  if p_period_month is not null and extract(day from p_period_month) <> 1 then
    perform private.fail('invalid_date');
  end if;
  amt := private.parse_amount(p_limit);
  if amt <= 0 then
    perform private.fail('non_positive_amount');
  end if;
  if p_envelope_id is not null then
    bud := private.active_budget(uid);
    perform private.require_spend_envelope(uid, bud.id, p_envelope_id);
  else
    perform private.require_category(uid, p_category_id, 'expense');
  end if;
  perform private.lock_user_scope(uid, 'limits');
  -- the cap counts new rows only: changing an existing limit always works
  if not exists (
    select 1 from public.limits l
    where l.user_id = uid and coalesce(l.envelope_id, l.category_id) = coalesce(p_envelope_id, p_category_id)
      and coalesce(l.period_month, date '0001-01-01') = coalesce(p_period_month, date '0001-01-01')
  ) and (select count(*) from public.limits l where l.user_id = uid) >= 200 then
    perform private.fail('limit_limit');
  end if;

  insert into public.limits (user_id, envelope_id, category_id, period_month, limit_minor)
  values (uid, p_envelope_id, p_category_id, p_period_month, amt)
  on conflict (user_id, coalesce(envelope_id, category_id), coalesce(period_month, date '0001-01-01'))
  do update set limit_minor = excluded.limit_minor
  returning id into v_id;
  return v_id;
end;
$$;

create function api.delete_limit(p_limit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  delete from public.limits where id = p_limit_id and user_id = uid;
  if not found then
    perform private.fail('unknown_limit');
  end if;
end;
$$;

/**
 * Limits that apply to p_month (a month-specific limit overrides the recurring one for the same
 * target) with what was spent that month, in the budget base currency, as text.
 * Envelope limits count what left the envelope for expenses; category limits count the book value
 * of expenses in that category on any account. Reversed entries and reversals don't count.
 * SECURITY DEFINER like every api function: every read is filtered by the caller's uid.
 */
create function api.limit_progress(p_month date)
returns table (
  limit_id uuid, envelope_id uuid, category_id uuid, period_month date, limit_minor text, spent_minor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  v_first date;
  v_next date;
begin
  if p_month is null then
    perform private.fail('invalid_date');
  end if;
  v_first := date_trunc('month', p_month)::date;
  v_next := (date_trunc('month', p_month) + interval '1 month')::date;
  return query
  with applicable as (
    select distinct on (coalesce(l.envelope_id, l.category_id)) l.*
    from public.limits l
    where l.user_id = uid and (l.period_month is null or l.period_month = v_first)
      -- limits on archived envelopes (method switch) or archived categories are not shown
      and (l.envelope_id is null or exists (
        select 1 from public.envelopes en where en.id = l.envelope_id and en.user_id = uid and en.archived_at is null))
      and (l.category_id is null or exists (
        select 1 from public.categories c where c.id = l.category_id and c.user_id = uid and c.archived_at is null))
    order by coalesce(l.envelope_id, l.category_id), l.period_month nulls last
  ),
  live as (
    -- reportable: neither reversed nor a reversal (R5)
    select e.id, e.category_id
    from public.ledger_entries e
    where e.user_id = uid and e.kind = 'expense' and e.occurred_on >= v_first and e.occurred_on < v_next
      and not exists (select 1 from public.ledger_entries r where r.user_id = uid and r.reverses_entry_id = e.id)
  )
  select
    a.id, a.envelope_id, a.category_id, a.period_month, a.limit_minor::text,
    coalesce(case
      when a.envelope_id is not null then (
        select -sum(el.amount_minor)
        from public.envelope_lines el
        join live on live.id = el.entry_id
        where el.user_id = uid and el.envelope_id = a.envelope_id
      )
      else (
        select -sum(ll.base_amount_minor)
        from public.ledger_lines ll
        join live on live.id = ll.entry_id
        join public.accounts ac on ac.id = ll.account_id and ac.kind <> 'system'
        where ll.user_id = uid and live.category_id = a.category_id
      )
    end, 0)::text
  from applicable a;
end;
$$;

-- ---------- transaction history (EXP-5) ----------
-- One row per entry and user account it touched (transfers have two). Allocation-only entries
-- (envelope moves) have no account line and are not listed. Amounts as text (CLAUDE.md rule 1).
create view public.entry_history with (security_invoker = true) as
  select
    e.id as entry_id,
    e.kind,
    e.occurred_on,
    e.created_at,
    e.category_id,
    e.note,
    e.reverses_entry_id,
    exists (select 1 from public.ledger_entries r where r.reverses_entry_id = e.id) as is_reversed,
    l.account_id,
    l.currency,
    l.amount_minor::text as amount_minor,
    l.base_amount_minor::text as base_amount_minor,
    (select el.envelope_id from public.envelope_lines el
      where el.entry_id = e.id and e.kind = 'expense' order by el.amount_minor limit 1) as envelope_id
  from public.ledger_entries e
  join public.ledger_lines l on l.entry_id = e.id
  join public.accounts a on a.id = l.account_id and a.kind <> 'system';

revoke all on public.entry_history from anon, authenticated;
grant select on public.entry_history to authenticated;

revoke execute on function private.require_spend_envelope(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.lock_user_scope(uuid, text) from public, anon, authenticated;
revoke execute on function api.create_category(public.category_kind, text, uuid, uuid) from public, anon;
revoke execute on function api.update_category(uuid, text, uuid, boolean) from public, anon;
revoke execute on function api.archive_category(uuid) from public, anon;
revoke execute on function api.set_limit(text, uuid, uuid, date) from public, anon;
revoke execute on function api.delete_limit(uuid) from public, anon;
revoke execute on function api.limit_progress(date) from public, anon;
grant execute on function api.create_category(public.category_kind, text, uuid, uuid) to authenticated;
grant execute on function api.update_category(uuid, text, uuid, boolean) to authenticated;
grant execute on function api.archive_category(uuid) to authenticated;
grant execute on function api.set_limit(text, uuid, uuid, date) to authenticated;
grant execute on function api.delete_limit(uuid) to authenticated;
grant execute on function api.limit_progress(date) to authenticated;
