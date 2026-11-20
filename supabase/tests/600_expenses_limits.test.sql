-- Migration 0009: categories (EXP-2), monthly limits and progress (EXP-4), history (EXP-5).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;
grant execute on function tests.login(uuid) to authenticated;
create function tests.env(p_kind text) returns uuid language sql as $$
  select envelope_id from public.envelope_balances where kind::text = p_kind and archived_at is null limit 1;
$$;
grant execute on function tests.env(text) to authenticated;
create function tests.progress(p_limit uuid, p_month date) returns text language sql as $$
  select spent_minor || '/' || limit_minor from api.limit_progress(p_month) where limit_id = p_limit;
$$;
grant execute on function tests.progress(uuid, date) to authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local');

-- ---------- privileges ----------
select ok(not has_table_privilege('anon', 'public.entry_history', 'select'), 'anon cannot read the history');
select ok(has_table_privilege('authenticated', 'public.entry_history', 'select'), 'users read their history');
select ok(
  not has_function_privilege('anon', 'api.set_limit(text, uuid, uuid, date)', 'execute')
  and not has_function_privilege('anon', 'api.create_category(public.category_kind, text, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'api.limit_progress(date)', 'execute'),
  'anon cannot call the new RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'private.require_spend_envelope(uuid, uuid, uuid)', 'execute'),
  'the envelope helper is private'
);
select ok(
  not has_table_privilege('authenticated', 'public.limits', 'insert')
  and not has_table_privilege('authenticated', 'public.categories', 'update'),
  'limits and categories change only through RPCs'
);

-- ---------- setup ----------
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'A: budget');
select set_config('t.cash',
  api.create_account('Cash', 'cash', 'KZT', 'a0000000-0000-4000-8000-000000000091', '100000000')::text, true);
select set_config('t.card',
  api.create_account('Card', 'card', 'KZT', 'a0000000-0000-4000-8000-000000000092')::text, true);
select set_config('t.needs', tests.env('needs')::text, true);
select set_config('t.wants', tests.env('wants')::text, true);
select set_config('t.groceries',
  (select id::text from public.categories where name_key = 'category.groceries'), true);

-- ---------- categories ----------
select set_config('t.coffee', api.create_category('expense', 'Coffee', 'a0000000-0000-4000-8000-000000000093',
  current_setting('t.wants')::uuid)::text, true);
select is(
  (select name || '|' || kind || '|' || (default_envelope_id = current_setting('t.wants')::uuid)
     from public.categories where id = current_setting('t.coffee')::uuid),
  'Coffee|expense|true', 'custom expense category with a default envelope'
);
select is(
  api.create_category('expense', 'Coffee', 'a0000000-0000-4000-8000-000000000093', current_setting('t.wants')::uuid)::text,
  current_setting('t.coffee'), 'an identical retry returns the same category'
);
select throws_ok(
  $$ select api.create_category('expense', 'Tea', 'a0000000-0000-4000-8000-000000000093') $$,
  'P0001', 'idempotency_conflict', 'same key, other parameters'
);
select throws_ok(
  $$ select api.create_category('expense', 'coffee', gen_random_uuid()) $$,
  'P0001', 'duplicate_name', 'names are unique per kind, case-insensitive'
);
select lives_ok(
  $$ select api.create_category('income', 'Coffee', gen_random_uuid()) $$,
  'the same name is fine for another kind'
);
select throws_ok(
  format($$ select api.create_category('income', 'Bonus', gen_random_uuid(), '%s') $$, current_setting('t.needs')),
  'P0001', 'invalid_input', 'income categories have no default envelope'
);
select throws_ok(
  format($$ select api.create_category('expense', 'Misc', gen_random_uuid(), '%s') $$, tests.env('unallocated')),
  'P0001', 'unknown_envelope', 'Unallocated cannot be a default envelope'
);
select throws_ok(
  $$ select api.create_category('expense', '   ', gen_random_uuid()) $$,
  'P0001', 'invalid_name', 'a name is required'
);

select lives_ok(
  format($$ select api.update_category('%s', 'Food', '%s') $$, current_setting('t.groceries'), current_setting('t.needs')),
  'rename a default category and give it a default envelope'
);
select is(
  (select coalesce(name, '-') || '|' || coalesce(name_key, '-') || '|' || (default_envelope_id = current_setting('t.needs')::uuid)
     from public.categories where id = current_setting('t.groceries')::uuid),
  'Food|-|true', 'the user name replaces the localised key'
);
select lives_ok(
  format($$ select api.update_category('%s', null, null, true) $$, current_setting('t.coffee')),
  'clear a default envelope'
);
select is(
  (select default_envelope_id from public.categories where id = current_setting('t.coffee')::uuid), null,
  'default envelope cleared'
);
select throws_ok(
  format($$ select api.update_category('%s', null, '%s', true) $$, current_setting('t.coffee'), current_setting('t.needs')),
  'P0001', 'invalid_input', 'cannot set and clear the default at once'
);
select lives_ok(format($$ select api.archive_category('%s') $$, current_setting('t.coffee')), 'archive a category');
select throws_ok(
  format($$ select api.record_expense('%s', '100', current_date, gen_random_uuid(), '%s', '%s') $$,
         current_setting('t.cash'), current_setting('t.needs'), current_setting('t.coffee')),
  'P0001', 'unknown_category', 'archived categories are not offered for new expenses'
);
select lives_ok(
  format($$ select api.archive_category('%s') $$, current_setting('t.coffee')),
  'archiving twice is a harmless retry'
);
select throws_ok(
  format($$ select api.update_category('%s', 'Food') $$,
         (select id from public.categories where name_key = 'category.transport')),
  'P0001', 'duplicate_name', 'a rename cannot take another active name'
);
select throws_ok(
  format($$ select api.update_category('%s', null, '%s') $$,
         (select id from public.categories where name_key = 'category.salary'), current_setting('t.needs')),
  'P0001', 'invalid_input', 'income categories cannot get a default envelope'
);
select throws_ok(
  $$ select api.create_category('expense', 'X', null) $$,
  'P0001', 'idempotency_key_required', 'a key is required'
);

-- ---------- limits ----------
select set_config('t.lim_needs', api.set_limit('5000000', current_setting('t.needs')::uuid)::text, true);
select set_config('t.lim_food', api.set_limit('2000000', null, current_setting('t.groceries')::uuid)::text, true);
select is(
  api.set_limit('6000000', current_setting('t.needs')::uuid)::text, current_setting('t.lim_needs'),
  'setting the same target again updates the limit (upsert)'
);
select is((select limit_minor from public.limits where id = current_setting('t.lim_needs')::uuid), 6000000::bigint, 'new amount');
select set_config('t.lim_needs_month',
  api.set_limit('1000000', current_setting('t.needs')::uuid, null, date_trunc('month', current_date)::date)::text, true);
select isnt(current_setting('t.lim_needs_month'), current_setting('t.lim_needs'), 'a month-specific limit is its own row');

select throws_ok($$ select api.set_limit('100') $$, 'P0001', 'invalid_input', 'a target is required');
select throws_ok(
  format($$ select api.set_limit('100', '%s', '%s') $$, current_setting('t.needs'), current_setting('t.groceries')),
  'P0001', 'invalid_input', 'only one target'
);
select throws_ok(
  format($$ select api.set_limit('100', '%s', null, (date_trunc('month', current_date) + interval '1 day')::date) $$, current_setting('t.needs')),
  'P0001', 'invalid_date', 'the period is the first day of a month'
);
select throws_ok(
  format($$ select api.set_limit('0', '%s') $$, current_setting('t.needs')),
  'P0001', 'non_positive_amount', 'limits are positive'
);
select throws_ok(
  format($$ select api.set_limit('100', '%s') $$, tests.env('unallocated')),
  'P0001', 'unknown_envelope', 'no limits on Unallocated'
);
select throws_ok(
  format($$ select api.set_limit('100', null, '%s') $$, (select id from public.categories where name_key = 'category.salary')),
  'P0001', 'unknown_category', 'limits are for expense categories'
);
select throws_ok(
  format($$ select api.set_limit('100', null, '%s') $$, current_setting('t.coffee')),
  'P0001', 'unknown_category', 'no limits on archived categories'
);
select throws_ok(
  format($$ select api.set_limit('12abc', '%s') $$, current_setting('t.needs')),
  'P0001', 'invalid_amount', 'malformed amounts are a domain error'
);

-- ---------- progress ----------
-- this month: 300.00 + 200.00 from Needs (Food), 50.00 from Wants; one 999.00 reversed; last month 700.00
select lives_ok(format($$ select api.record_expense('%s', '30000', current_date, 'a0000000-0000-4000-8000-0000000000a1', '%s', '%s') $$,
  current_setting('t.cash'), current_setting('t.needs'), current_setting('t.groceries')), 'expense 300.00');
select lives_ok(format($$ select api.record_expense('%s', '20000', current_date, 'a0000000-0000-4000-8000-0000000000a2', '%s', '%s') $$,
  current_setting('t.cash'), current_setting('t.needs'), current_setting('t.groceries')), 'expense 200.00');
select lives_ok(format($$ select api.record_expense('%s', '5000', current_date, 'a0000000-0000-4000-8000-0000000000a3', '%s') $$,
  current_setting('t.cash'), current_setting('t.wants')), 'expense 50.00 without category');
select set_config('t.wrong', api.record_expense(current_setting('t.cash')::uuid, '99900', current_date,
  'a0000000-0000-4000-8000-0000000000a4', current_setting('t.needs')::uuid, current_setting('t.groceries')::uuid)::text, true);
select lives_ok(format($$ select api.reverse_entry('%s', 'a0000000-0000-4000-8000-0000000000a5') $$, current_setting('t.wrong')),
  'reverse the 999.00 mistake');
select lives_ok(format($$ select api.record_expense('%s', '70000', (date_trunc('month', current_date) - interval '1 day')::date,
  'a0000000-0000-4000-8000-0000000000a6', '%s', '%s') $$, current_setting('t.cash'), current_setting('t.needs'), current_setting('t.groceries')),
  'expense last month');

select is(tests.progress(current_setting('t.lim_needs_month')::uuid, current_date), '50000/1000000',
  'Needs this month: the month override applies; 500.00 spent, reversal and last month left out');
select is(tests.progress(current_setting('t.lim_needs')::uuid, current_date), null,
  'the recurring Needs limit is hidden by the override this month');
select is(tests.progress(current_setting('t.lim_needs')::uuid, (date_trunc('month', current_date) - interval '1 day')::date),
  '70000/6000000', 'last month the recurring limit applies with last month''s spending');
select is(tests.progress(current_setting('t.lim_food')::uuid, current_date), '50000/2000000',
  'category limit counts the category on any envelope');
select throws_ok($$ select * from api.limit_progress(null) $$, 'P0001', 'invalid_date', 'a month is required');

select is(
  (select spent_minor from api.limit_progress((date_trunc('month', current_date) + interval '2 months')::date)
    where limit_id = current_setting('t.lim_food')::uuid),
  '0', 'a month without spending reports 0'
);
select is(
  (select count(*)::int from public.entry_history where kind = 'income' and envelope_id is not null), 0,
  'only expenses carry an envelope in the history'
);

-- a limit on a category that is archived later is no longer reported
select set_config('t.taxi', api.create_category('expense', 'Taxi', gen_random_uuid())::text, true);
select set_config('t.lim_taxi', api.set_limit('100000', null, current_setting('t.taxi')::uuid)::text, true);
select isnt(tests.progress(current_setting('t.lim_taxi')::uuid, current_date), null, 'the taxi limit is reported');
select lives_ok(format($$ select api.archive_category('%s') $$, current_setting('t.taxi')), 'archive Taxi');
select is(tests.progress(current_setting('t.lim_taxi')::uuid, current_date), null, 'limits on archived categories are hidden');

-- delete
select lives_ok(format($$ select api.delete_limit('%s') $$, current_setting('t.lim_needs_month')), 'delete the override');
select is(tests.progress(current_setting('t.lim_needs')::uuid, current_date), '50000/6000000', 'the recurring limit is back');
select throws_ok(format($$ select api.delete_limit('%s') $$, current_setting('t.lim_needs_month')),
  'P0001', 'unknown_limit', 'deleting twice is reported');

-- ---------- history ----------
select is(
  (select count(*)::int from public.entry_history where kind = 'expense' and not is_reversed), 4,
  'history lists the live expenses (3 this month + 1 last month)'
);
select is(
  (select is_reversed from public.entry_history where entry_id = current_setting('t.wrong')::uuid), true,
  'the reversed expense is flagged'
);
select is(
  (select count(*)::int from public.entry_history where reverses_entry_id = current_setting('t.wrong')::uuid), 1,
  'its reversal is listed too (the UI hides the pair)'
);
select is(
  (select amount_minor || '|' || base_amount_minor || '|' || (envelope_id = current_setting('t.needs')::uuid)
     from public.entry_history where entry_id = (
       select id from public.ledger_entries where idempotency_key = 'a0000000-0000-4000-8000-0000000000a1')),
  '-30000|-30000|true', 'amounts as text and the envelope of the expense'
);
select lives_ok(format($$ select api.record_transfer('%s', '%s', '10000', '10000', current_date, 'a0000000-0000-4000-8000-0000000000a7') $$,
  current_setting('t.cash'), current_setting('t.card')), 'a transfer');
select is(
  (select count(*)::int from public.entry_history where kind = 'transfer'), 2,
  'a transfer shows on both accounts'
);
select is(
  (select count(*)::int from public.entry_history h join public.accounts a on a.id = h.account_id where a.kind = 'system'), 0,
  'hidden system accounts never appear'
);

-- ---------- isolation ----------
select tests.login('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'B: budget');
select throws_ok(
  format($$ select api.update_category('%s', 'Mine') $$, current_setting('t.groceries')),
  'P0001', 'unknown_category', 'B cannot rename A''s category'
);
select throws_ok(
  format($$ select api.set_limit('100', '%s') $$, current_setting('t.needs')),
  'P0001', 'unknown_envelope', 'B cannot limit A''s envelope'
);
select throws_ok(
  format($$ select api.delete_limit('%s') $$, current_setting('t.lim_needs')),
  'P0001', 'unknown_limit', 'B cannot delete A''s limit'
);
select throws_ok(
  format($$ select api.create_category('expense', 'X', gen_random_uuid(), '%s') $$, current_setting('t.needs')),
  'P0001', 'unknown_envelope', 'B cannot point a category at A''s envelope'
);
select is((select count(*)::int from public.entry_history), 0, 'B sees none of A''s history');
select is(
  (select count(*)::int from public.limits) + (select count(*)::int from public.categories where name = 'Food'), 0,
  'B reads none of A''s limits or categories directly'
);
select lives_ok(
  $$ select api.create_category('expense', 'Coffee', 'a0000000-0000-4000-8000-000000000093') $$,
  'idempotency keys are per user: A''s key is free for B'
);
select is((select count(*)::int from api.limit_progress(current_date)), 0, 'B sees none of A''s limits');

-- caps: at 200 limits a new one is refused, an existing one can still change
select set_config('t.b_food', (select id::text from public.categories where name_key = 'category.groceries'), true);
select lives_ok(
  format($$ select count(api.set_limit('100', null, '%s', (date '2000-01-01' + make_interval(months => g))::date))
            from generate_series(0, 199) g $$, current_setting('t.b_food')),
  'B fills 200 limits'
);
select throws_ok(
  format($$ select api.set_limit('100', null, '%s') $$, current_setting('t.b_food')),
  'P0001', 'limit_limit', 'the 201st limit is refused'
);
select lives_ok(
  format($$ select api.set_limit('500', null, '%s', date '2000-01-01') $$, current_setting('t.b_food')),
  'changing an existing limit works at the cap'
);
select throws_ok(
  $$ select count(api.create_category('expense', 'C' || g, gen_random_uuid())) from generate_series(1, 120) g $$,
  'P0001', 'category_limit', 'at most 100 active categories'
);

reset role;
select is(private.reconciliation_gap('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'R1 holds');

select * from finish();
rollback;
