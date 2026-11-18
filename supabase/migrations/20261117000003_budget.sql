-- UMANI 0003: budgets, envelopes, categories, limits, savings goals (DATABASE.md §3)
-- Composite foreign keys (id, user_id) make cross-user references impossible at the schema level.

create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  base_currency char(3) not null references public.currencies (code),
  method        public.budget_method not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (id, user_id)
);
create unique index budgets_one_active_per_user on public.budgets (user_id) where is_active;
create index budgets_user_idx on public.budgets (user_id);

-- R7: the base currency is fixed once the budget exists (a rebase flow is post-v1).
create function private.guard_budget_base_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.base_currency <> old.base_currency then
    perform private.fail('base_currency_immutable');
  end if;
  return new;
end;
$$;

create trigger budgets_base_currency_immutable
  before update of base_currency on public.budgets
  for each row execute function private.guard_budget_base_currency();

create table public.envelopes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  budget_id      uuid not null,
  name           text check (name is null or char_length(btrim(name)) between 1 and 40),
  name_key       text check (name_key is null or char_length(name_key) <= 64),
  kind           public.envelope_kind not null,
  allocation_bps int not null check (allocation_bps between 0 and 10000),
  sort_order     int not null,
  is_system      boolean not null default false,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (id, user_id),
  foreign key (budget_id, user_id) references public.budgets (id, user_id) on delete cascade,
  check (name is not null or name_key is not null),
  check ((kind = 'unallocated') = is_system),
  check (kind <> 'unallocated' or allocation_bps = 0)
);
create index envelopes_user_idx on public.envelopes (user_id);
create index envelopes_budget_idx on public.envelopes (budget_id);
create unique index envelopes_one_unallocated on public.envelopes (budget_id) where kind = 'unallocated';
-- Distinct sort order keeps the rounding tie-break deterministic (DATABASE.md §5).
create unique index envelopes_sort_order on public.envelopes (budget_id, sort_order) where archived_at is null;

create table public.categories (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  kind                public.category_kind not null,
  name                text check (name is null or char_length(btrim(name)) between 1 and 40),
  name_key            text check (name_key is null or char_length(name_key) <= 64),
  icon                text check (icon is null or char_length(icon) <= 64),
  default_envelope_id uuid,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (id, user_id),
  foreign key (default_envelope_id, user_id)
    references public.envelopes (id, user_id) on delete set null (default_envelope_id),
  check (name is not null or name_key is not null)
);
create index categories_user_idx on public.categories (user_id);
create index categories_default_envelope_idx on public.categories (default_envelope_id);

create table public.limits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  envelope_id  uuid,
  category_id  uuid,
  period_month date check (period_month is null or extract(day from period_month) = 1),
  limit_minor  bigint not null check (limit_minor > 0 and limit_minor <= 1000000000000000),
  created_at   timestamptz not null default now(),
  foreign key (envelope_id, user_id) references public.envelopes (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade,
  check (num_nonnulls(envelope_id, category_id) = 1)
);
create index limits_user_idx on public.limits (user_id);
create index limits_envelope_idx on public.limits (envelope_id);
create index limits_category_idx on public.limits (category_id);

create table public.savings_goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  envelope_id  uuid not null,
  target_minor bigint not null check (target_minor > 0 and target_minor <= 1000000000000000),
  target_date  date,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (envelope_id, user_id) references public.envelopes (id, user_id) on delete cascade
);
create unique index savings_goals_one_active on public.savings_goals (envelope_id) where archived_at is null;
create index savings_goals_user_idx on public.savings_goals (user_id);

-- ---------- RLS: read own rows; all writes go through api.* RPCs ----------
do $$
declare
  t text;
begin
  foreach t in array array['budgets', 'envelopes', 'categories', 'limits', 'savings_goals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select_own', t
    );
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
