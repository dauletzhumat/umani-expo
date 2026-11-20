-- api.change_budget_method (migration 0008, PRD BUD-3): carry-over, reassignment, idempotency,
-- validation, isolation and R1.
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
-- active envelopes as "kind:bps:balance" in sort order
create function tests.layout() returns text language sql as $$
  select string_agg(kind::text || ':' || allocation_bps || ':' || balance_minor, ' ' order by sort_order)
  from public.envelope_balances where archived_at is null and kind <> 'unallocated';
$$;
grant execute on function tests.layout() to authenticated;
create function tests.unallocated() returns text language sql as $$
  select balance_minor from public.envelope_balances where kind = 'unallocated';
$$;
grant execute on function tests.unallocated() to authenticated;
create function tests.env_id(p_kind text) returns uuid language sql as $$
  select envelope_id from public.envelope_balances where kind::text = p_kind and archived_at is null limit 1;
$$;
grant execute on function tests.env_id(text) to authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local');

-- ---------- privileges ----------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.budget_method_changes'::regclass),
  'RLS is enabled on budget_method_changes'
);
select ok(
  not has_table_privilege('authenticated', 'public.budget_method_changes', 'insert')
  and not has_table_privilege('authenticated', 'public.budget_method_changes', 'update')
  and not has_table_privilege('authenticated', 'public.budget_method_changes', 'delete'),
  'users cannot write the switch history directly'
);
select ok(
  not has_function_privilege('anon', 'api.change_budget_method(public.budget_method, uuid, jsonb, jsonb)', 'execute'),
  'anon cannot switch methods'
);
select ok(
  not has_function_privilege('authenticated', 'private.preset_layout(public.budget_method)', 'execute'),
  'the preset helper is private'
);

-- ---------- setup: 50/30/20 with money in every envelope ----------
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'A: 50/30/20 in KZT');
select set_config('t.cash',
  api.create_account('Cash', 'cash', 'KZT', 'a0000000-0000-4000-8000-000000000081')::text, true);
-- 10 000.00 income → 5 000 / 3 000 / 2 000
select lives_ok(
  $$ select api.record_income(current_setting('t.cash')::uuid, '1000000', current_date,
       'a0000000-0000-4000-8000-000000000082') $$,
  'A: income allocated by 50/30/20'
);
select is(tests.layout(), 'needs:5000:500000 wants:3000:300000 savings:2000:200000', 'starting layout');
select set_config('t.needs', tests.env_id('needs')::text, true);
select set_config('t.wants', tests.env_id('wants')::text, true);
select set_config('t.savings', tests.env_id('savings')::text, true);

-- ---------- validation ----------
select throws_ok(
  $$ select api.change_budget_method('80_20', null) $$,
  'P0001', 'idempotency_key_required', 'a key is required'
);
select throws_ok(
  $$ select api.change_budget_method('80_20', gen_random_uuid(), '[]'::jsonb) $$,
  'P0001', 'invalid_custom_budget', 'presets take no custom layout'
);
select throws_ok(
  $$ select api.change_budget_method('custom', gen_random_uuid(),
       '[{"name":"A","allocation_bps":6000},{"name":"B","allocation_bps":3000}]'::jsonb) $$,
  'P0001', 'not_100_percent', 'custom shares must total 100%'
);
select throws_ok(
  $$ select api.change_budget_method('custom', gen_random_uuid(),
       '[{"name":"Food","allocation_bps":5000},{"name":"food","allocation_bps":5000}]'::jsonb) $$,
  'P0001', 'duplicate_name', 'custom names are unique (case-insensitive)'
);
select throws_ok(
  format($$ select api.change_budget_method('custom', gen_random_uuid(),
       '[{"name":"A","allocation_bps":5000,"envelope_id":"%s"},{"name":"B","allocation_bps":5000,"envelope_id":"%s"}]'::jsonb) $$,
       current_setting('t.needs'), current_setting('t.needs')),
  'P0001', 'unknown_envelope', 'an envelope can be kept only once'
);
select throws_ok(
  format($$ select api.change_budget_method('80_20', gen_random_uuid(), null, '{"%s": 0}'::jsonb) $$,
         current_setting('t.savings')),
  'P0001', 'invalid_reassign', 'a kept envelope (Savings) is not reassigned'
);
select throws_ok(
  format($$ select api.change_budget_method('80_20', gen_random_uuid(), null, '{"%s": 2}'::jsonb) $$,
         current_setting('t.needs')),
  'P0001', 'invalid_reassign', 'the target index must exist in the new layout'
);
select throws_ok(
  format($$ select api.change_budget_method('80_20', gen_random_uuid(), null, '{"%s": "needs"}'::jsonb) $$,
         current_setting('t.needs')),
  'P0001', 'invalid_reassign', 'targets are an index or "unallocated"'
);
select is(tests.layout(), 'needs:5000:500000 wants:3000:300000 savings:2000:200000', 'failed switches change nothing');

select throws_ok(
  format($$ select api.change_budget_method('80_20', gen_random_uuid(), null, '{"not-a-uuid": 0}'::jsonb) $$),
  'P0001', 'invalid_reassign', 'a malformed reassign key is rejected cleanly'
);
select throws_ok(
  $$ select api.change_budget_method('80_20', gen_random_uuid(), null, '{"00000000-0000-4000-8000-000000000000": 0}'::jsonb) $$,
  'P0001', 'invalid_reassign', 'an unknown envelope cannot be reassigned'
);
select throws_ok(
  $$ select api.change_budget_method('80_20', 'a0000000-0000-4000-8000-000000000082') $$,
  'P0001', 'idempotency_conflict', 'a key already used by an income is a conflict'
);
-- a category whose default envelope will be removed
reset role;
update public.categories set default_envelope_id = current_setting('t.wants')::uuid
where name_key = (select name_key from public.categories where kind = 'expense' order by name_key limit 1)
  and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- ---------- preset → preset ----------
select set_config('t.change1', api.change_budget_method('80_20', 'a0000000-0000-4000-8000-000000000083', null,
  format('{"%s": 0, "%s": "unallocated"}', current_setting('t.needs'), current_setting('t.wants'))::jsonb)::text, true);
select is(tests.layout(), 'spending:8000:500000 savings:2000:200000',
  'Needs moved into the new Spending; Savings kept with its balance');
select is(tests.env_id('savings')::text, current_setting('t.savings'), 'Savings is the same envelope');
select is(tests.unallocated(), '300000', 'Wants went to Unallocated');
select is((select method::text from public.budgets where is_active), '80_20', 'the budget uses the new method');
select is(
  (select count(*)::int from public.envelopes where archived_at is not null), 2,
  'Needs and Wants are archived, not deleted'
);
select is(
  (select format('%s→%s', from_method, to_method) from public.budget_method_changes where id = current_setting('t.change1')::uuid),
  '50_30_20→80_20', 'the switch is recorded'
);
select is(
  (select sum(l.amount_minor)::text from public.envelope_lines l
     join public.budget_method_changes c on c.entry_id = l.entry_id
    where c.id = current_setting('t.change1')::uuid),
  '0', 'the move is one zero-sum allocation entry'
);

-- idempotency
select is(
  api.change_budget_method('80_20', 'a0000000-0000-4000-8000-000000000083', null,
    format('{"%s": 0, "%s": "unallocated"}', current_setting('t.needs'), current_setting('t.wants'))::jsonb)::text,
  current_setting('t.change1'), 'an identical retry returns the same switch'
);
select is(tests.layout(), 'spending:8000:500000 savings:2000:200000', 'and changes nothing');
select throws_ok(
  $$ select api.change_budget_method('90_10', 'a0000000-0000-4000-8000-000000000083') $$,
  'P0001', 'idempotency_conflict', 'the same key with other parameters is a conflict'
);
select throws_ok(
  format($$ select api.change_budget_method('80_20', 'a0000000-0000-4000-8000-000000000083', null, '{"%s": 0, "%s": 0}'::jsonb) $$,
         current_setting('t.needs'), current_setting('t.wants')),
  'P0001', 'idempotency_conflict', 'the same key with another reassignment is a conflict'
);
select is(
  (select count(*)::int from public.categories where default_envelope_id is not null), 0,
  'no category keeps a removed envelope as its default'
);

-- new income uses the new weights; nothing to move → no entry
select lives_ok(
  $$ select api.record_income(current_setting('t.cash')::uuid, '100000', current_date,
       'a0000000-0000-4000-8000-000000000084') $$,
  'A: income after the switch'
);
select is(tests.layout(), 'spending:8000:580000 savings:2000:220000', '1 000.00 split 80/20');
select set_config('t.change2', api.change_budget_method('90_10', 'a0000000-0000-4000-8000-000000000085')::text, true);
select is(tests.layout(), 'spending:9000:580000 savings:1000:220000', 'same kinds: only the shares change');
select is(
  (select entry_id from public.budget_method_changes where id = current_setting('t.change2')::uuid), null,
  'no envelope removed → no allocation entry'
);

-- ---------- preset → custom, keeping Savings by id ----------
select set_config('t.spending', tests.env_id('spending')::text, true);
select set_config('t.change3', api.change_budget_method('custom', 'a0000000-0000-4000-8000-000000000086',
  format('[{"name":"Cushion","allocation_bps":3000,"kind":"savings","envelope_id":"%s"},{"name":"Food","allocation_bps":7000}]',
         current_setting('t.savings'))::jsonb,
  format('{"%s": 1}', current_setting('t.spending'))::jsonb)::text, true);
select is(tests.layout(), 'savings:3000:220000 custom:7000:580000',
  'Savings renamed and re-weighted; Spending moved into the new Food envelope');
select is(
  (select string_agg(coalesce(name, name_key), ', ' order by sort_order) from public.envelopes where archived_at is null and not is_system),
  'Cushion, Food', 'custom names replace the preset name keys'
);
select is((select method::text from public.budgets where is_active), 'custom', 'the budget is custom now');

-- custom → custom: reorder both kept envelopes (the sort_order shuffle again); Cushion has no
-- "kind" in the payload and stays Savings; the target index is written as 1.0
select lives_ok(
  format($$ select api.change_budget_method('custom', gen_random_uuid(),
       '[{"name":"Food","allocation_bps":7000,"envelope_id":"%s"},{"name":"Cushion","allocation_bps":3000,"envelope_id":"%s"}]'::jsonb) $$,
       (select envelope_id from public.envelope_balances where name = 'Food'), current_setting('t.savings')),
  'A: custom → custom with a new order'
);
select is(tests.layout(), 'custom:7000:580000 savings:3000:220000', 'order swapped, balances and kinds kept');
select lives_ok(
  format($$ select api.change_budget_method('custom', gen_random_uuid(),
       '[{"name":"Food","allocation_bps":6000,"envelope_id":"%s"},{"name":"Fun","allocation_bps":1000},{"name":"Cushion","allocation_bps":3000,"envelope_id":"%s"}]'::jsonb) $$,
       (select envelope_id from public.envelope_balances where name = 'Food'), current_setting('t.savings')),
  'A: add an envelope in the middle'
);
select is(tests.layout(), 'custom:6000:580000 custom:1000:0 savings:3000:220000', 'new envelope starts empty');
select set_config('t.fun', (select envelope_id::text from public.envelope_balances where name = 'Fun'), true);
select lives_ok(
  format($$ select api.change_budget_method('custom', gen_random_uuid(),
       '[{"name":"Food","allocation_bps":7000,"envelope_id":"%s"},{"name":"Cushion","allocation_bps":3000,"envelope_id":"%s"}]'::jsonb,
       '{"%s": 1.0}'::jsonb) $$,
       (select envelope_id from public.envelope_balances where name = 'Food'), current_setting('t.savings'), current_setting('t.fun')),
  'A: remove Fun with a target index written as 1.0'
);

-- negative balances move too (R8: overspent envelopes)
select lives_ok(
  $$ select api.record_expense(current_setting('t.cash')::uuid, '700000', current_date,
       'a0000000-0000-4000-8000-000000000087', (select envelope_id from public.envelope_balances where name = 'Food')) $$,
  'A: overspend Food by 1 200.00'
);
select lives_ok(
  $$ select api.change_budget_method('70_20_10', 'a0000000-0000-4000-8000-000000000088') $$,
  'A: back to a preset, Food goes to Unallocated by default'
);
select is(tests.unallocated(), '180000', 'Unallocated took Food''s −1 200.00 (300 000 − 120 000)');
select is(tests.layout(), 'living:7000:0 savings:2000:220000 debt_giving:1000:0', 'Cushion kept as Savings; new envelopes start empty');

-- ---------- isolation ----------
select tests.login('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select throws_ok(
  $$ select api.change_budget_method('80_20', gen_random_uuid()) $$,
  'P0001', 'no_active_budget', 'B has no budget yet'
);
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'B: budget');
select throws_ok(
  format($$ select api.change_budget_method('custom', gen_random_uuid(),
       '[{"name":"Mine","allocation_bps":10000,"envelope_id":"%s"}]'::jsonb) $$, current_setting('t.savings')),
  'P0001', 'unknown_envelope', 'B cannot keep A''s envelope'
);
select throws_ok(
  format($$ select api.change_budget_method('80_20', gen_random_uuid(), null, '{"%s": 0}'::jsonb) $$,
         current_setting('t.savings')),
  'P0001', 'invalid_reassign', 'B cannot move A''s envelope'
);
select is((select count(*)::int from public.budget_method_changes), 0, 'B sees none of A''s switches');

-- ---------- invariants ----------
reset role;
select is(private.reconciliation_gap('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'R1 holds after every switch');
select lives_ok('set constraints all immediate', 'deferred ledger checks pass at commit');
set constraints all deferred;

-- account deletion still works after method switches (cascades through the history table)
select lives_ok($$ select private.purge_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$, 'purge after switches');
select is(
  (select count(*)::int from public.budget_method_changes where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0,
  'the switch history goes with the account'
);

select * from finish();
rollback;
