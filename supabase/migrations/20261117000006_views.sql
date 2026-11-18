-- UMANI 0006: read views (DATABASE.md §6). security_invoker = true, so the caller's RLS applies.
-- Amounts are returned as text: PostgREST serialises bigint as a JSON number (CLAUDE.md rule 1).

create view public.account_balances with (security_invoker = true) as
  select
    a.id as account_id,
    a.user_id,
    a.name,
    a.kind,
    a.currency,
    a.include_in_budget,
    a.linked_envelope_id,
    a.archived_at,
    coalesce(sum(l.amount_minor), 0)::text      as balance_minor,
    coalesce(sum(l.base_amount_minor), 0)::text as book_value_minor
  from public.accounts a
  left join public.ledger_lines l on l.account_id = a.id
  where a.kind <> 'system'
  group by a.id;

create view public.envelope_balances with (security_invoker = true) as
  select
    e.id as envelope_id,
    e.user_id,
    e.budget_id,
    e.name,
    e.name_key,
    e.kind,
    e.allocation_bps,
    e.sort_order,
    e.archived_at,
    coalesce(sum(l.amount_minor), 0)::text as balance_minor
  from public.envelopes e
  left join public.envelope_lines l on l.envelope_id = e.id
  group by e.id;

-- Entries that count in reports: neither reversed nor reversals (R5).
create view public.reportable_entries with (security_invoker = true) as
  select e.*
  from public.ledger_entries e
  where e.kind <> 'reversal'
    and not exists (select 1 from public.ledger_entries r where r.reverses_entry_id = e.id);

-- Income and expense per month in base currency, from user-account book values.
create view public.monthly_summary with (security_invoker = true) as
  select
    e.user_id,
    date_trunc('month', e.occurred_on)::date as month,
    coalesce(sum(l.base_amount_minor) filter (where e.kind = 'income'), 0)::text   as income_minor,
    coalesce(-sum(l.base_amount_minor) filter (where e.kind = 'expense'), 0)::text as expense_minor
  from public.reportable_entries e
  join public.ledger_lines l on l.entry_id = e.id and l.base_amount_minor is not null
  where e.kind in ('income', 'expense')
  group by e.user_id, date_trunc('month', e.occurred_on);

create view public.category_monthly with (security_invoker = true) as
  select
    e.user_id,
    date_trunc('month', e.occurred_on)::date as month,
    e.category_id,
    coalesce(-sum(l.base_amount_minor), 0)::text as expense_minor
  from public.reportable_entries e
  join public.ledger_lines l on l.entry_id = e.id and l.base_amount_minor is not null
  where e.kind = 'expense'
  group by e.user_id, date_trunc('month', e.occurred_on), e.category_id;

do $$
declare
  v text;
begin
  foreach v in array array[
    'account_balances', 'envelope_balances', 'reportable_entries', 'monthly_summary', 'category_monthly'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end;
$$;
