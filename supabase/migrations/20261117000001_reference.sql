-- UMANI 0001: schemas, enums, reference data, shared helpers (DATABASE.md §1–2)

create schema if not exists api;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke all on schema api from public, anon;
grant usage on schema api to authenticated, service_role;

-- New functions must never be executable by everyone by default. The PUBLIC EXECUTE default is
-- global, so it has to be revoked globally (a schema-scoped revoke removes nothing). Every
-- migration that adds functions still ends with explicit revoke/grant statements.
alter default privileges for role postgres revoke execute on functions from public;

-- ---------- enums (mirrored in src/domain) ----------
create type public.budget_method as enum ('50_30_20', '80_20', '90_10', '70_20_10', 'custom');
create type public.envelope_kind as enum
  ('needs', 'wants', 'savings', 'spending', 'living', 'debt_giving', 'custom', 'unallocated');
create type public.account_kind as enum ('cash', 'card', 'current', 'savings', 'deposit', 'system');
create type public.system_role as enum ('income', 'expense', 'opening_balance', 'fx_clearing', 'adjustment');
create type public.entry_kind as enum
  ('opening_balance', 'income', 'expense', 'transfer', 'allocation', 'adjustment', 'fx_revaluation', 'reversal');
create type public.category_kind as enum ('income', 'expense');

-- ---------- reference data ----------
create table public.currencies (
  code        char(3) primary key,
  minor_units smallint not null check (minor_units between 0 and 4),
  symbol      text not null
);

insert into public.currencies (code, minor_units, symbol) values
  ('KZT', 2, '₸'), ('USD', 2, '$'), ('EUR', 2, '€'), ('RUB', 2, '₽'), ('CNY', 2, '¥');

alter table public.currencies enable row level security;
create policy currencies_select_all on public.currencies for select to authenticated using (true);
revoke all on public.currencies from anon, authenticated;
grant select on public.currencies to authenticated;

-- ---------- helpers: errors, parsing, exact rounding (mirror src/domain/money) ----------

-- All expected failures raise P0001 with the same codes the TS domain uses.
create function private.fail(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

-- Canonical integer string of minor units → bigint, |x| ≤ 10^15 (src/domain/money/wire.ts).
create function private.parse_amount(p text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p is null or p !~ '^(0|-?[1-9][0-9]{0,15})$' then
    perform private.fail('invalid_amount');
  end if;
  v := p::numeric;
  if abs(v) > 1000000000000000 then
    perform private.fail('out_of_range');
  end if;
  return v::bigint;
end;
$$;

-- Strict positive decimal rate: ≤ 12 integer digits, ≤ 12 decimals, so it fits numeric(24,12)
-- (src/domain/money/convert.ts). NULL stays NULL.
create function private.parse_rate(p text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p is null then
    return null;
  end if;
  if length(p) > 25 or p !~ '^[0-9]{1,12}(\.[0-9]{1,12})?$' then
    perform private.fail('invalid_rate');
  end if;
  v := p::numeric;
  if v <= 0 then
    perform private.fail('invalid_rate');
  end if;
  return v;
end;
$$;

-- Round an exact numeric half to even.
create function private.round_half_even(x numeric)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  q numeric := trunc(x);
  f numeric := abs(x - trunc(x));
begin
  if f > 0.5 or (f = 0.5 and mod(q, 2) <> 0) then
    q := q + sign(x);
  end if;
  return q;
end;
$$;

-- Integer division rounded half to even (src/domain/money/rounding.ts).
create function private.div_half_even(p_num numeric, p_den numeric)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  n numeric := abs(p_num);
  q numeric;
  r numeric;
begin
  if p_den <= 0 then
    raise exception 'denominator must be positive';
  end if;
  q := div(n, p_den);
  r := n - q * p_den;
  if 2 * r > p_den or (2 * r = p_den and mod(q, 2) = 1) then
    q := q + 1;
  end if;
  return case when p_num < 0 then -q else q end;
end;
$$;

-- amount (minor units of p_src) × rate → minor units of p_dst, half-even (convert.ts).
create function private.convert(p_amount bigint, p_src char(3), p_rate numeric, p_dst char(3))
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  src_mu smallint;
  dst_mu smallint;
  v numeric;
begin
  select minor_units into src_mu from public.currencies where code = p_src;
  select minor_units into dst_mu from public.currencies where code = p_dst;
  if src_mu is null or dst_mu is null then
    perform private.fail('unknown_currency');
  end if;
  v := private.round_half_even(p_amount::numeric * p_rate * power(10::numeric, dst_mu - src_mu));
  if abs(v) > 1000000000000000 then
    perform private.fail('out_of_range');
  end if;
  return v::bigint;
end;
$$;

-- Largest-remainder split by basis points; ties to the lower index (src/domain/money/allocate.ts).
create function private.allocate_bps(p_total bigint, p_weights int[])
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  n int := coalesce(array_length(p_weights, 1), 0);
  parts bigint[] := '{}';
  rems numeric[] := '{}';
  allocated bigint := 0;
  leftover bigint;
  i int;
  idx bigint;
begin
  if p_total < 0 then perform private.fail('negative_total'); end if;
  if n = 0 then perform private.fail('no_weights'); end if;
  if exists (select 1 from unnest(p_weights) w where w is null or w < 0 or w > 10000) then
    perform private.fail('invalid_weight');
  end if;
  if (select sum(w) from unnest(p_weights) w) <> 10000 then
    perform private.fail('weights_not_100_percent');
  end if;

  for i in 1..n loop
    parts[i] := div(p_total::numeric * p_weights[i], 10000)::bigint;
    rems[i] := mod(p_total::numeric * p_weights[i], 10000);
    allocated := allocated + parts[i];
  end loop;

  leftover := p_total - allocated;
  for idx in
    select t.o from unnest(rems) with ordinality as t(r, o) order by t.r desc, t.o asc limit leftover
  loop
    parts[idx] := parts[idx] + 1;
  end loop;

  return parts;
end;
$$;

-- Book value leaving a position (src/domain/fx/book-value.ts valueOutgoing): moving average up to
-- the positive balance, overdraft excess at the confirmed rate. Returns a positive base amount.
create function private.book_out(
  p_balance bigint, p_book bigint, p_amount bigint, p_currency char(3), p_base char(3), p_rate numeric
)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  available bigint := greatest(p_balance, 0);
  covered bigint;
  from_avg numeric := 0;
  from_rate bigint := 0;
  total numeric;
begin
  if p_amount <= 0 then perform private.fail('non_positive_amount'); end if;
  if p_currency = p_base then return p_amount; end if;

  covered := least(p_amount, available);
  if covered > 0 then
    from_avg := case when covered = available then p_book
                     else private.div_half_even(p_book::numeric * covered, available) end;
  end if;
  if p_amount > covered then
    if p_rate is null then perform private.fail('rate_required'); end if;
    from_rate := private.convert(p_amount - covered, p_currency, p_rate, p_base);
  end if;

  total := from_avg + from_rate;
  if abs(total) > 1000000000000000 then perform private.fail('out_of_range'); end if;
  return total::bigint;
end;
$$;

-- Book value entering from outside (valueIncoming). Positive amounts only.
create function private.book_in(p_amount bigint, p_currency char(3), p_base char(3), p_rate numeric)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_amount <= 0 then perform private.fail('non_positive_amount'); end if;
  if p_currency = p_base then return p_amount; end if;
  if p_rate is null then perform private.fail('rate_required'); end if;
  return private.convert(p_amount, p_currency, p_rate, p_base);
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
