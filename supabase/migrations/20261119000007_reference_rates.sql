-- UMANI 0007: reference FX rates from the National Bank of Kazakhstan, and the rate lookup used
-- to pre-fill rates and to show approximate totals (PRD ACC-4, INC-4; DATABASE.md §5a R2, R4).
--
-- Reference data like public.currencies: readable by every signed-in user, written only by the
-- sync-reference-rates Edge Function (service role). Never used for book values by itself: every
-- rate that changes the ledger is still confirmed by the user in the RPC call.

create table public.reference_rates (
  currency     char(3) not null references public.currencies (code),
  rate_date    date not null,
  -- tenge per one unit of the currency (the feed publishes per `quant` units; the sync divides)
  kzt_per_unit numeric(24, 12) not null check (kzt_per_unit > 0),
  source       text not null default 'nbk' check (source = 'nbk'),
  fetched_at   timestamptz not null default now(),
  primary key (currency, rate_date),
  check (currency <> 'KZT')
);

alter table public.reference_rates enable row level security;
create policy reference_rates_select_all on public.reference_rates
  for select to authenticated using (true);
revoke all on public.reference_rates from anon, authenticated;
grant select on public.reference_rates to authenticated;
grant select, insert, update on public.reference_rates to service_role;

-- api.fx_rate reads a user's newest inflow per currency; without this it scans all their lines.
create index ledger_lines_user_currency_idx on public.ledger_lines (user_id, currency)
  include (entry_id, account_id, amount_minor, base_amount_minor) where amount_minor > 0;

-- Latest tenge value of one unit of p_currency and its date. KZT is always 1, dated today in
-- Almaty (the NBK publishes per Almaty calendar day; the server runs in UTC).
create function private.latest_kzt_per_unit(p_currency char(3), out kzt numeric, out as_of date)
language sql
stable
set search_path = ''
as $$
  select 1::numeric, (now() at time zone 'Asia/Almaty')::date where p_currency = 'KZT'
  union all
  (select r.kzt_per_unit, r.rate_date
     from public.reference_rates r
    where r.currency = p_currency and p_currency <> 'KZT'
    order by r.rate_date desc
    limit 1);
$$;

/**
 * Rate to convert one unit of p_from into p_to, for pre-filling and approximate totals.
 *
 * Sources, newest wins (a tie goes to the user's rate):
 * - 'user': the last rate the user confirmed for p_from → their budget base currency. It is read
 *   back from the book value of money that entered a p_from account from outside (opening balance,
 *   income, positive adjustment), so it exists only when p_to is the base currency. Inflows under
 *   one unit of p_from are ignored: their book value is rounded to a minor unit, so the derived
 *   rate can be far off (0.01 USD at 475.5 stores 4.76 → 476, or worse for smaller rates).
 * - 'nbk': the latest National Bank of Kazakhstan rates, crossed through KZT.
 * Returns no row when neither exists. The rate is a decimal string (CLAUDE.md rule 1).
 */
create function api.fx_rate(p_from char(3), p_to char(3))
returns table (rate text, source text, as_of date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  base char(3);
  from_mu smallint;
  to_mu smallint;
  user_rate numeric;
  user_on date;
  ref_from record;
  ref_to record;
  ref_rate numeric;
  ref_on date;
begin
  if uid is null then
    perform private.fail('not_authenticated');
  end if;
  select minor_units into from_mu from public.currencies where code = p_from;
  select minor_units into to_mu from public.currencies where code = p_to;
  if from_mu is null or to_mu is null then
    perform private.fail('unknown_currency');
  end if;

  if p_from = p_to then
    return query select '1'::text, 'identity'::text, current_date;
    return;
  end if;

  select b.base_currency into base from public.budgets b where b.user_id = uid and b.is_active;

  if base = p_to then
    select l.base_amount_minor::numeric / l.amount_minor * power(10::numeric, from_mu - to_mu), e.occurred_on
      into user_rate, user_on
      from public.ledger_lines l
      join public.ledger_entries e on e.id = l.entry_id and e.user_id = uid
      join public.accounts a on a.id = l.account_id and a.user_id = uid and a.kind <> 'system'
     where l.user_id = uid
       and l.currency = p_from
       and l.amount_minor >= power(10, from_mu)
       and l.base_amount_minor > 0
       and e.kind in ('opening_balance', 'income', 'adjustment')
       and not exists (select 1 from public.ledger_entries r where r.reverses_entry_id = e.id)
     order by e.occurred_on desc, e.created_at desc, l.id desc
     limit 1;
  end if;

  select * into ref_from from private.latest_kzt_per_unit(p_from);
  select * into ref_to from private.latest_kzt_per_unit(p_to);
  if ref_from.kzt is not null and ref_to.kzt is not null then
    ref_rate := ref_from.kzt / ref_to.kzt;
    ref_on := least(ref_from.as_of, ref_to.as_of);
  end if;

  if user_rate is not null and (ref_rate is null or user_on >= ref_on) then
    return query select trim_scale(round(user_rate, 10))::text, 'user'::text, user_on;
  elsif ref_rate is not null then
    return query select trim_scale(round(ref_rate, 10))::text, 'nbk'::text, ref_on;
  end if;
end;
$$;

revoke execute on function private.latest_kzt_per_unit(char, out numeric, out date) from public, anon, authenticated;
revoke execute on function api.fx_rate(char, char) from public, anon;
grant execute on function api.fx_rate(char, char) to authenticated;
