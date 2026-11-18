-- UMANI 0004: accounts and the append-only double-entry ledger (DATABASE.md §3, §5a, §7)

create table public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 1 and 60),
  kind               public.account_kind not null,
  system_role        public.system_role,
  currency           char(3) not null references public.currencies (code),
  institution        text check (institution is null or char_length(institution) <= 100),
  linked_envelope_id uuid,
  include_in_budget  boolean not null default true,
  idempotency_key    uuid,
  request_hash       bytea,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, idempotency_key),
  foreign key (linked_envelope_id, user_id)
    references public.envelopes (id, user_id) on delete set null (linked_envelope_id),
  check ((kind = 'system') = (system_role is not null)),
  check (kind <> 'system' or (include_in_budget = false and linked_envelope_id is null))
);
-- (user_id) lookups use the unique (user_id, idempotency_key) index prefix.
create index accounts_linked_envelope_idx on public.accounts (linked_envelope_id);
create unique index accounts_one_system_per_role_currency
  on public.accounts (user_id, system_role, currency) where kind = 'system';

create table public.ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              public.entry_kind not null,
  occurred_on       date not null,
  category_id       uuid,
  note              text check (note is null or char_length(note) <= 500),
  reverses_entry_id uuid unique,
  idempotency_key   uuid not null,
  request_hash      bytea not null,
  created_at        timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, idempotency_key),
  foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete set null (category_id),
  foreign key (reverses_entry_id, user_id) references public.ledger_entries (id, user_id),
  check ((kind = 'reversal') = (reverses_entry_id is not null))
);
create index ledger_entries_user_date_idx on public.ledger_entries (user_id, occurred_on desc);
create index ledger_entries_category_idx on public.ledger_entries (category_id);

create table public.ledger_lines (
  id                uuid primary key default gen_random_uuid(),
  entry_id          uuid not null,
  user_id           uuid not null,
  account_id        uuid not null,
  amount_minor      bigint not null check (abs(amount_minor) <= 1000000000000000),
  currency          char(3) not null references public.currencies (code),
  base_amount_minor bigint check (base_amount_minor is null or abs(base_amount_minor) <= 1000000000000000),
  foreign key (entry_id, user_id) references public.ledger_entries (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.accounts (id, user_id)
);
create index ledger_lines_entry_idx on public.ledger_lines (entry_id);
-- covering: account positions and balances are sums over these columns
create index ledger_lines_account_idx on public.ledger_lines (account_id) include (amount_minor, base_amount_minor);
create index ledger_lines_user_idx on public.ledger_lines (user_id);

create table public.envelope_lines (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null,
  user_id      uuid not null,
  envelope_id  uuid not null,
  amount_minor bigint not null check (amount_minor <> 0 and abs(amount_minor) <= 1000000000000000),
  fx_rate      numeric(24, 12) check (fx_rate is null or fx_rate > 0),
  foreign key (entry_id, user_id) references public.ledger_entries (id, user_id) on delete cascade,
  foreign key (envelope_id, user_id) references public.envelopes (id, user_id)
);
create index envelope_lines_entry_idx on public.envelope_lines (entry_id);
create index envelope_lines_envelope_idx on public.envelope_lines (envelope_id) include (amount_minor);
create index envelope_lines_user_idx on public.envelope_lines (user_id);

-- ---------- line shape (DATABASE.md §3) ----------
create function private.check_ledger_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc_currency char(3);
  acc_kind public.account_kind;
  e_kind public.entry_kind;
  e_reverses uuid;
begin
  select currency, kind into acc_currency, acc_kind from public.accounts where id = new.account_id;
  if new.currency <> acc_currency then
    perform private.fail('currency_mismatch');
  end if;
  if acc_kind = 'system' and new.base_amount_minor is not null then
    perform private.fail('base_on_system_line');
  end if;
  if acc_kind <> 'system' and new.base_amount_minor is null then
    perform private.fail('base_missing');
  end if;
  -- An account in the budget base currency always has book value = balance (R2).
  if acc_kind <> 'system' and new.base_amount_minor <> new.amount_minor and exists (
    select 1 from public.budgets b
    where b.user_id = new.user_id and b.is_active and b.base_currency = acc_currency
  ) then
    perform private.fail('base_amount_mismatch');
  end if;
  if new.amount_minor = 0 then
    -- Only revaluation lines (and their reversals) may have a zero amount.
    select kind, reverses_entry_id into e_kind, e_reverses from public.ledger_entries where id = new.entry_id;
    if not (
      e_kind = 'fx_revaluation'
      or (e_kind = 'reversal'
          and (select kind from public.ledger_entries where id = e_reverses) = 'fx_revaluation')
    ) then
      perform private.fail('zero_line');
    end if;
  end if;
  return new;
end;
$$;

create trigger ledger_lines_shape
  before insert on public.ledger_lines
  for each row execute function private.check_ledger_line();

-- ---------- L1: every entry sums to zero per currency, checked at commit ----------
create function private.check_entry_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.ledger_lines
    where entry_id = new.entry_id
    group by currency
    having sum(amount_minor) <> 0
  ) then
    perform private.fail('unbalanced');
  end if;
  return null;
end;
$$;

create constraint trigger ledger_lines_balanced
  after insert on public.ledger_lines
  deferrable initially deferred
  for each row execute function private.check_entry_balanced();

-- ---------- E1: allocation entries only move budget between envelopes ----------
create function private.check_allocation_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select kind from public.ledger_entries where id = new.entry_id) = 'allocation'
     and (select sum(amount_minor) from public.envelope_lines where entry_id = new.entry_id) <> 0 then
    perform private.fail('allocation_unbalanced');
  end if;
  return null;
end;
$$;

create constraint trigger envelope_lines_allocation_balanced
  after insert on public.envelope_lines
  deferrable initially deferred
  for each row execute function private.check_allocation_balanced();

-- ---------- append-only guard (only private.purge_user may delete) ----------
create function private.guard_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  purging text := current_setting('umani.purge_user', true);
begin
  if purging is not null and purging <> '' and purging = old.user_id::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform private.fail('ledger_append_only');
  return null;
end;
$$;

create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function private.guard_ledger();
create trigger ledger_lines_append_only before update or delete on public.ledger_lines
  for each row execute function private.guard_ledger();
create trigger envelope_lines_append_only before update or delete on public.envelope_lines
  for each row execute function private.guard_ledger();

-- Row triggers do not fire on TRUNCATE, so block it explicitly.
create function private.forbid_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.fail('ledger_append_only');
  return null;
end;
$$;

create trigger ledger_entries_no_truncate before truncate on public.ledger_entries
  for each statement execute function private.forbid_truncate();
create trigger ledger_lines_no_truncate before truncate on public.ledger_lines
  for each statement execute function private.forbid_truncate();
create trigger envelope_lines_no_truncate before truncate on public.envelope_lines
  for each statement execute function private.forbid_truncate();

-- ---------- every entry carries lines (checked at commit) ----------
-- Non-allocation entries need ledger lines; allocations move budget only (envelope lines).
create function private.check_entry_has_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'allocation' then
    if exists (select 1 from public.ledger_lines where entry_id = new.id)
       or not exists (select 1 from public.envelope_lines where entry_id = new.id) then
      perform private.fail('empty_entry');
    end if;
  elsif not exists (select 1 from public.ledger_lines where entry_id = new.id) then
    perform private.fail('empty_entry');
  end if;
  return null;
end;
$$;

create constraint trigger ledger_entries_have_lines
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function private.check_entry_has_lines();

-- ---------- account currency is immutable ----------
create function private.guard_account_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency <> old.currency then
    perform private.fail('currency_immutable');
  end if;
  return new;
end;
$$;

create trigger accounts_currency_immutable
  before update of currency on public.accounts
  for each row execute function private.guard_account_currency();

-- ---------- account deletion (DATABASE.md §7): the only path that removes ledger rows ----------
create function private.purge_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('umani.purge_user', p_user_id::text, true);
  -- Ledger rows first: their FKs to accounts/envelopes are NO ACTION, so they must be gone
  -- before the auth.users cascade removes accounts and envelopes.
  delete from public.envelope_lines where user_id = p_user_id;
  delete from public.ledger_lines where user_id = p_user_id;
  delete from public.ledger_entries where user_id = p_user_id;
  delete from auth.users where id = p_user_id;
  perform set_config('umani.purge_user', '', true);
end;
$$;

-- ---------- reconciliation checks used by tests and monitoring ----------
-- R1: Σ envelope lines − Σ book value of budgeted accounts; must be 0.
create function private.reconciliation_gap(p_user_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce((select sum(amount_minor) from public.envelope_lines where user_id = p_user_id), 0)
       - coalesce((
           select sum(l.base_amount_minor)
           from public.ledger_lines l
           join public.accounts a on a.id = l.account_id
           where l.user_id = p_user_id and a.include_in_budget and a.kind <> 'system'
         ), 0);
$$;

-- Base-currency accounts whose book value differs from their balance; must be 0.
create function private.base_drift_count(p_user_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*) from (
    select a.id
    from public.accounts a
    join public.budgets b on b.user_id = a.user_id and b.is_active and b.base_currency = a.currency
    left join public.ledger_lines l on l.account_id = a.id
    where a.user_id = p_user_id and a.kind <> 'system'
    group by a.id
    having coalesce(sum(l.amount_minor), 0) <> coalesce(sum(l.base_amount_minor), 0)
  ) drift;
$$;

-- R1 enforced by the database at commit, not only by RPC discipline. The check scans the
-- user's lines (indexed by user_id); fine at personal-finance scale, revisit with snapshots.
create function private.check_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.reconciliation_gap(new.user_id) <> 0 then
    perform private.fail('reconciliation_gap');
  end if;
  return null;
end;
$$;

create constraint trigger ledger_lines_reconciled
  after insert on public.ledger_lines
  deferrable initially deferred
  for each row execute function private.check_reconciliation();
create constraint trigger envelope_lines_reconciled
  after insert on public.envelope_lines
  deferrable initially deferred
  for each row execute function private.check_reconciliation();

-- ---------- RLS: read own rows; writes only through api.* RPCs ----------
do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'ledger_entries', 'ledger_lines', 'envelope_lines'] loop
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
grant execute on function private.purge_user(uuid) to service_role;
