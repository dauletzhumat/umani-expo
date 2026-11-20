-- Migration 0010: savings goals (BUD-7) and the deposit planner flow (DEP-3, DEP-4).
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
create function tests.balance(p_envelope uuid) returns text language sql as $$
  select balance_minor from public.envelope_balances where envelope_id = p_envelope;
$$;
grant execute on function tests.balance(uuid) to authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local');

-- ---------- privileges ----------
select ok(
  not has_function_privilege('anon', 'api.set_savings_goal(uuid, text, date)', 'execute')
  and not has_function_privilege('anon', 'api.archive_savings_goal(uuid)', 'execute'),
  'anon cannot call the goal RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.savings_goals', 'insert')
  and not has_table_privilege('authenticated', 'public.savings_goals', 'update'),
  'goals change only through RPCs'
);

-- ---------- setup ----------
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'A: budget');
select set_config('t.savings', tests.env('savings')::text, true);
select set_config('t.needs', tests.env('needs')::text, true);

-- ---------- goals ----------
select set_config('t.goal', api.set_savings_goal(current_setting('t.savings')::uuid, '100000000',
  (current_date + 365))::text, true);
select is(
  (select target_minor || '|' || (target_date = current_date + 365) from public.savings_goals
    where id = current_setting('t.goal')::uuid),
  '100000000|true', 'a goal on the savings envelope with a target date'
);
select is(
  api.set_savings_goal(current_setting('t.savings')::uuid, '150000000')::text, current_setting('t.goal'),
  'setting it again changes the same goal (upsert)'
);
select is(
  (select target_minor || '|' || coalesce(target_date::text, 'none') from public.savings_goals
    where id = current_setting('t.goal')::uuid),
  '150000000|none', 'new target, date cleared'
);
select is((select count(*)::int from public.savings_goals where archived_at is null), 1, 'one active goal per envelope');

select throws_ok(
  format($$ select api.set_savings_goal('%s', '100') $$, current_setting('t.needs')),
  'P0001', 'unknown_envelope', 'goals are for savings envelopes only'
);
select throws_ok(
  format($$ select api.set_savings_goal('%s', '100') $$, tests.env('unallocated')),
  'P0001', 'unknown_envelope', 'not on Unallocated'
);
select throws_ok($$ select api.set_savings_goal(null, '100') $$, 'P0001', 'unknown_envelope', 'an envelope is required');
select throws_ok(
  format($$ select api.set_savings_goal('%s', '0') $$, current_setting('t.savings')),
  'P0001', 'non_positive_amount', 'a target above zero'
);
select throws_ok(
  format($$ select api.set_savings_goal('%s', '12x') $$, current_setting('t.savings')),
  'P0001', 'invalid_amount', 'malformed targets are a domain error'
);
select throws_ok(
  format($$ select api.set_savings_goal('%s', '100', current_date - 2) $$, current_setting('t.savings')),
  'P0001', 'invalid_date', 'the target date is not in the past'
);
select lives_ok(
  format($$ select api.set_savings_goal('%s', '100000000', current_date - 1) $$, current_setting('t.savings')),
  'one day of slack: "today" in a time zone behind UTC is accepted'
);
select throws_ok(
  format($$ select api.set_savings_goal('%s', '1000000000000001') $$, current_setting('t.savings')),
  'P0001', 'out_of_range', 'targets stay within the money range'
);

select lives_ok(format($$ select api.archive_savings_goal('%s') $$, current_setting('t.goal')), 'archive the goal');
select set_config('t.archived_at', (select archived_at::text from public.savings_goals where id = current_setting('t.goal')::uuid), true);
select lives_ok(format($$ select api.archive_savings_goal('%s') $$, current_setting('t.goal')), 'archiving twice is a no-op');
select is(
  (select archived_at::text from public.savings_goals where id = current_setting('t.goal')::uuid),
  current_setting('t.archived_at'), 'the second archive keeps the original time'
);
select is((select count(*)::int from public.savings_goals where archived_at is null), 0, 'no active goal left');
select isnt(
  api.set_savings_goal(current_setting('t.savings')::uuid, '5000000')::text, current_setting('t.goal'),
  'a new goal after archiving is a new row (history kept)'
);
select throws_ok(
  $$ select api.archive_savings_goal('00000000-0000-4000-8000-000000000000') $$,
  'P0001', 'unknown_goal', 'unknown goal'
);

-- ---------- deposit planner: open a linked deposit, contribute by transfer (DEP-3, DEP-4) ----------
select set_config('t.cash',
  api.create_account('Cash', 'cash', 'KZT', 'a0000000-0000-4000-8000-0000000000b1', '50000000')::text, true);
select lives_ok(
  format($$ select api.reallocate('%s', '%s', '20000000', current_date, 'a0000000-0000-4000-8000-0000000000b2') $$,
         tests.env('unallocated'), current_setting('t.savings')),
  'assign money to Savings'
);
select set_config('t.deposit', api.create_account('UMANI · Savings', 'deposit', 'KZT',
  'a0000000-0000-4000-8000-0000000000b3', null, null, null, true, current_setting('t.savings')::uuid)::text, true);
select is(
  (select kind || '|' || include_in_budget || '|' || (linked_envelope_id = current_setting('t.savings')::uuid)
     from public.accounts where id = current_setting('t.deposit')::uuid),
  'deposit|true|true', 'the opened deposit is budgeted and linked to the savings envelope'
);
select set_config('t.before', tests.balance(current_setting('t.savings')::uuid), true);
select lives_ok(
  format($$ select api.record_transfer('%s', '%s', '10000000', '10000000', current_date,
                                       'a0000000-0000-4000-8000-0000000000b4') $$,
         current_setting('t.cash'), current_setting('t.deposit')),
  'a contribution is a transfer cash → deposit'
);
select is(tests.balance(current_setting('t.savings')::uuid), current_setting('t.before'),
  'moving money into the deposit does not change envelopes (R3)');
select is(
  (select balance_minor from public.account_balances where account_id = current_setting('t.deposit')::uuid),
  '10000000', 'the deposit holds the contribution'
);

-- ---------- isolation ----------
select tests.login('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'B: budget');
select throws_ok(
  format($$ select api.set_savings_goal('%s', '100') $$, current_setting('t.savings')),
  'P0001', 'unknown_envelope', 'B cannot set a goal on A''s envelope'
);
select throws_ok(
  format($$ select api.archive_savings_goal('%s') $$, current_setting('t.goal')),
  'P0001', 'unknown_goal', 'B cannot archive A''s goal'
);
select is((select count(*)::int from public.savings_goals), 0, 'B reads none of A''s goals');

-- a method switch that removes the savings envelope archives its goal (no orphans)
select set_config('t.b_goal', api.set_savings_goal(tests.env('savings'), '100000')::text, true);
select lives_ok(
  $$ select api.change_budget_method('custom', 'b0000000-0000-4000-8000-0000000000c1',
       '[{"name": "Everything", "allocation_bps": 10000, "kind": "custom"}]'::jsonb) $$,
  'B switches to a custom layout without a savings envelope'
);
select isnt(
  (select archived_at from public.savings_goals where id = current_setting('t.b_goal')::uuid), null,
  'the goal of the removed savings envelope is archived'
);

reset role;
select is(
  (select target_minor || '|' || (archived_at is null) from public.savings_goals
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and archived_at is null),
  '5000000|true', 'A''s goal is untouched by B''s attempts'
);

reset role;
select is(private.reconciliation_gap('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'R1 holds');

select * from finish();
rollback;
