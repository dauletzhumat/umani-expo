-- RLS, privileges and cross-user isolation (DATABASE.md §7, CLAUDE.md rule 4)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------- test helpers (rolled back with the transaction) ----------
create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;
grant execute on function tests.login(uuid) to authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local');

-- ---------- schema-level guarantees ----------
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'RLS is enabled on every table in public'
);

select ok(
  not has_table_privilege('anon', 'public.' || t, 'select'),
  'anon cannot read ' || t
)
from unnest(array[
  'profiles', 'budgets', 'envelopes', 'categories', 'limits', 'savings_goals', 'accounts',
  'ledger_entries', 'ledger_lines', 'envelope_lines', 'account_balances', 'envelope_balances',
  'reportable_entries', 'monthly_summary', 'category_monthly'
]) as t;

select ok(
  not has_table_privilege('authenticated', 'public.' || t, 'insert')
  and not has_table_privilege('authenticated', 'public.' || t, 'update')
  and not has_table_privilege('authenticated', 'public.' || t, 'delete')
  and not has_table_privilege('authenticated', 'public.' || t, 'truncate'),
  'authenticated cannot write ' || t || ' directly'
)
from unnest(array[
  'currencies', 'budgets', 'envelopes', 'categories', 'limits', 'savings_goals', 'accounts',
  'ledger_entries', 'ledger_lines', 'envelope_lines'
]) as t;

select ok(has_column_privilege('authenticated', 'public.profiles', 'locale', 'update'),
  'profiles: locale is user-editable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'base_currency', 'update'),
  'profiles: base_currency is not directly editable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'id', 'update'),
  'profiles: id is not editable');

select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has no access to private');
select ok(not has_schema_privilege('anon', 'api', 'usage'), 'anon has no access to api');
select ok(not has_function_privilege('authenticated', 'private.purge_user(uuid)', 'execute'),
  'authenticated cannot purge users');
select ok(has_function_privilege('service_role', 'private.purge_user(uuid)', 'execute'),
  'service_role can purge users');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'execute')
  ),
  'anon cannot execute any api function'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and not p.prosecdef
  ),
  'every api function is SECURITY DEFINER'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'private')
      and not coalesce(p.proconfig @> array['search_path=""'], false)
  ),
  'every api/private function pins an empty search_path'
);

select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  ),
  'no private function is executable by anon or authenticated'
);
select ok(not has_function_privilege('authenticated', 'api.purge_account(uuid)', 'execute'),
  'authenticated cannot call purge_account');
select ok(has_function_privilege('service_role', 'api.purge_account(uuid)', 'execute'),
  'service_role can call purge_account');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'ai_consent_at', 'update'),
  'AI consent cannot be written directly');

-- ---------- user A creates data ----------
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'A sets up a budget');

select throws_ok($$ update public.profiles set timezone = 'Mars/Olympus' $$,
  'P0001', 'invalid_timezone', 'timezone must be a real IANA name');
select lives_ok($$ update public.profiles set timezone = 'Asia/Aqtobe', locale = 'kk' $$,
  'user updates allowed profile columns');
select isnt(api.set_ai_consent(true), null, 'AI consent is recorded with server time');
select is(api.set_ai_consent(false), null, 'AI consent can be withdrawn');
select lives_ok(
  $$ select set_config('t.a_cash',
       api.create_account('Cash', 'cash', 'KZT', 'aaaaaaaa-0000-4000-8000-000000000001', '100000')::text, true) $$,
  'A creates an account with an opening balance'
);
select set_config('t.a_needs', (select id::text from public.envelopes where kind = 'needs'), true);
select set_config('t.a_entry', (select id::text from public.ledger_entries limit 1), true);

select is((select count(*)::int from public.profiles), 1, 'A sees exactly one profile (own)');
select is((select count(*)::int from public.account_balances), 1, 'A sees own account');
select is((select balance_minor from public.account_balances), '100000', 'balances come back as text');

-- ---------- user B sees nothing of A ----------
reset role;
select tests.login('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

select is((select count(*)::int from public.profiles), 1, 'B sees only own profile');
select is((select count(*)::int from public.budgets), 0, 'B cannot see A budgets');
select is((select count(*)::int from public.envelopes), 0, 'B cannot see A envelopes');
select is((select count(*)::int from public.categories), 0, 'B cannot see A categories');
select is((select count(*)::int from public.accounts), 0, 'B cannot see A accounts');
select is((select count(*)::int from public.ledger_entries), 0, 'B cannot see A entries');
select is((select count(*)::int from public.ledger_lines), 0, 'B cannot see A ledger lines');
select is((select count(*)::int from public.envelope_lines), 0, 'B cannot see A envelope lines');
select is((select count(*)::int from public.account_balances), 0, 'B cannot see A balances');

select throws_ok(
  $$ insert into public.ledger_entries (user_id, kind, occurred_on, idempotency_key, request_hash)
     values (auth.uid(), 'income', current_date, gen_random_uuid(), '\x00') $$,
  '42501', null, 'B cannot insert ledger entries directly'
);
select throws_ok(
  $$ update public.profiles set base_currency = 'USD' $$,
  '42501', null, 'B cannot update protected profile columns'
);

select lives_ok($$ select api.setup_budget('80_20', 'KZT') $$, 'B sets up own budget');
select throws_ok(
  format($$ select api.record_income(%L, '100', current_date, gen_random_uuid()) $$, current_setting('t.a_cash')),
  'P0001', 'account_not_found', 'B cannot post income to A account'
);
select throws_ok(
  format($$ select api.reverse_entry(%L, gen_random_uuid()) $$, current_setting('t.a_entry')),
  'P0001', 'entry_not_found', 'B cannot reverse A entry'
);
select throws_ok(
  format($$ select api.create_account('X', 'cash', 'KZT', gen_random_uuid(), null, null, null, true, %L) $$,
         current_setting('t.a_needs')),
  'P0001', 'unknown_envelope', 'B cannot link an account to A envelope'
);

-- ---------- anon ----------
reset role;
set local role anon;
select throws_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, '42501', null, 'anon cannot call RPCs');
select throws_ok($$ select * from public.accounts $$, '42501', null, 'anon cannot read accounts');

reset role;
-- Deferred invariant triggers normally fire at COMMIT; fire them now (they run SECURITY DEFINER,
-- so this also proves they work after the caller's role has changed back).
select lives_ok('set constraints all immediate', 'deferred invariants hold for everything written above');
select * from finish();
rollback;
