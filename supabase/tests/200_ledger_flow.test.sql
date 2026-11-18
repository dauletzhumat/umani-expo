-- End-to-end ledger flow through api.* RPCs (DATABASE.md §4 examples, §5a rules R1–R8)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;
grant execute on function tests.login(uuid) to authenticated;
-- envelope balance by kind, as text (the view returns text)
create function tests.env(p_kind text) returns text language sql as $$
  select balance_minor from public.envelope_balances where kind::text = p_kind;
$$;
grant execute on function tests.env(text) to authenticated;
create function tests.bal(p_account text) returns text language sql as $$
  select balance_minor from public.account_balances where account_id = current_setting(p_account)::uuid;
$$;
grant execute on function tests.bal(text) to authenticated;

insert into auth.users (id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local');
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- ---------- setup ----------
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'setup 50/30/20 in KZT');
select is((select count(*)::int from public.envelopes), 4, 'three method envelopes + Unallocated');
select is(
  (select array_agg(allocation_bps order by sort_order) from public.envelopes),
  array[5000, 3000, 2000, 0],
  'preset weights in sort order'
);
select is((select count(*)::int from public.categories), 14, 'default categories seeded');
select throws_ok($$ select api.setup_budget('80_20', 'KZT') $$, 'P0001', 'budget_exists', 'one active budget');

select set_config('t.needs', (select id::text from public.envelopes where kind = 'needs'), true);
select set_config('t.wants', (select id::text from public.envelopes where kind = 'wants'), true);
select set_config('t.savings', (select id::text from public.envelopes where kind = 'savings'), true);

select set_config('t.cash',
  api.create_account('Cash', 'cash', 'KZT', 'a0000000-0000-4000-8000-000000000001', '20000000')::text, true);
select set_config('t.kaspi',
  api.create_account('Kaspi Gold', 'card', 'KZT', 'a0000000-0000-4000-8000-000000000002')::text, true);
select set_config('t.usd',
  api.create_account('USD card', 'card', 'USD', 'a0000000-0000-4000-8000-000000000003')::text, true);
select set_config('t.broker',
  api.create_account(p_name => 'Broker', p_kind => 'current', p_currency => 'KZT',
                     p_idempotency_key => 'a0000000-0000-4000-8000-000000000004',
                     p_include_in_budget => false)::text, true);

select is(tests.bal('t.cash'), '20000000', 'opening balance 200 000 ₸');
select is(tests.env('unallocated'), '20000000', 'opening balance goes to Unallocated');
select is(
  api.create_account('Cash', 'cash', 'KZT', 'a0000000-0000-4000-8000-000000000001', '20000000')::text,
  current_setting('t.cash'),
  'create_account is idempotent'
);
select throws_ok(
  $$ select api.create_account('Cash 2', 'cash', 'KZT', 'a0000000-0000-4000-8000-000000000001', '20000000') $$,
  'P0001', 'idempotency_conflict', 'create_account key reuse with different data'
);
select throws_ok(
  $$ select api.create_account('X', 'system', 'KZT', gen_random_uuid()) $$,
  'P0001', 'invalid_kind', 'users cannot create system accounts'
);

-- ---------- income ----------
select set_config('t.i1', api.record_income(current_setting('t.kaspi')::uuid, '50000000', current_date,
  'a0000000-0000-4000-8000-0000000000a1')::text, true);
select is(tests.env('needs'), '25000000', 'income 500 000 ₸: Needs 50%');
select is(tests.env('wants'), '15000000', 'income 500 000 ₸: Wants 30%');
select is(tests.env('savings'), '10000000', 'income 500 000 ₸: Savings 20%');

select set_config('t.i2', api.record_income(current_setting('t.usd')::uuid, '100000', current_date,
  'a0000000-0000-4000-8000-0000000000a2', p_fx_rate => '505.00')::text, true);
select is(
  (select base_amount_minor from public.ledger_lines where entry_id = current_setting('t.i2')::uuid
     and account_id = current_setting('t.usd')::uuid),
  50500000::bigint,
  'income 1 000 USD at 505.00 is booked at 505 000 ₸'
);
select is(tests.env('needs'), '50250000', 'USD income split into envelopes in KZT');
select is(
  (select fx_rate from public.envelope_lines where entry_id = current_setting('t.i2')::uuid limit 1),
  505.000000000000::numeric(24, 12),
  'confirmed rate stored on FX income'
);
select throws_ok(
  format($$ select api.record_income(%L, '100', current_date, gen_random_uuid()) $$, current_setting('t.usd')),
  'P0001', 'rate_required', 'foreign income needs a rate'
);

-- manual split with remainder to Unallocated (R6)
select lives_ok(
  format($$ select api.record_income(%L, '1000', current_date, gen_random_uuid(),
            p_allocation => jsonb_build_object('mode', 'manual', 'parts',
              jsonb_build_array(jsonb_build_object('envelope_id', %L, 'amount', '600')))) $$,
         current_setting('t.kaspi'), current_setting('t.savings')),
  'manual income split'
);
select is(tests.env('savings'), '20100600', 'manual part to Savings');
select is(tests.env('unallocated'), '20000400', 'remainder to Unallocated');
select throws_ok(
  format($$ select api.record_income(%L, '1000', current_date, gen_random_uuid(),
            p_allocation => jsonb_build_object('mode', 'manual', 'parts',
              jsonb_build_array(jsonb_build_object('envelope_id', %L, 'amount', '1001')))) $$,
         current_setting('t.kaspi'), current_setting('t.savings')),
  'P0001', 'exceeds_total', 'manual parts cannot exceed the income'
);

-- ---------- expenses ----------
select set_config('t.e1', api.record_expense(current_setting('t.cash')::uuid, '1250000', current_date,
  'a0000000-0000-4000-8000-0000000000e1', current_setting('t.needs')::uuid)::text, true);
select is(tests.bal('t.cash'), '18750000', 'expense 12 500 ₸ from cash');

select set_config('t.e2', api.record_expense(current_setting('t.usd')::uuid, '4000', current_date,
  'a0000000-0000-4000-8000-0000000000e2', current_setting('t.wants')::uuid)::text, true);
select is(
  (select base_amount_minor from public.ledger_lines where entry_id = current_setting('t.e2')::uuid
     and account_id = current_setting('t.usd')::uuid),
  (-2020000)::bigint,
  '40 USD expense at moving average = 20 200 ₸'
);

-- idempotency
select is(
  api.record_expense(current_setting('t.usd')::uuid, '4000', current_date,
    'a0000000-0000-4000-8000-0000000000e2', current_setting('t.wants')::uuid)::text,
  current_setting('t.e2'),
  'retry with the same key returns the same entry'
);
select throws_ok(
  format($$ select api.record_expense(%L, '4001', current_date, 'a0000000-0000-4000-8000-0000000000e2', %L) $$,
         current_setting('t.usd'), current_setting('t.wants')),
  'P0001', 'idempotency_conflict', 'same key with different data is rejected'
);

-- ---------- transfers ----------
select set_config('t.t1', api.record_transfer(current_setting('t.usd')::uuid, current_setting('t.kaspi')::uuid,
  '10000', '5030000', current_date, 'a0000000-0000-4000-8000-0000000000f1')::text, true);
select is(
  (select base_amount_minor from public.ledger_lines where entry_id = current_setting('t.t1')::uuid
     and account_id = current_setting('t.usd')::uuid),
  (-5050000)::bigint,
  'transfer out of USD at moving average'
);
select is(
  (select amount_minor from public.envelope_lines where entry_id = current_setting('t.t1')::uuid),
  (-20000)::bigint,
  '100 USD → 50 300 ₸ realises a 200 ₸ loss in Unallocated'
);
select is(
  (select count(*)::int from public.ledger_lines l join public.accounts a on a.id = l.account_id
     where l.entry_id = current_setting('t.t1')::uuid and a.kind = 'system'),
  2,
  'cross-currency transfer uses two FX clearing lines'
);

select lives_ok(
  format($$ select api.record_transfer(%L, %L, '1000000', '1000000', current_date, gen_random_uuid()) $$,
         current_setting('t.kaspi'), current_setting('t.broker')),
  'transfer to an unbudgeted account'
);
select is(tests.env('unallocated'), '18980400', 'money leaving the budget comes out of Unallocated');

-- ---------- reallocation, adjustment, revaluation ----------
select lives_ok(
  format($$ select api.reallocate(%L, %L, '500', current_date, gen_random_uuid()) $$,
         current_setting('t.wants'), current_setting('t.savings')),
  'reallocate Wants → Savings'
);
select lives_ok(
  format($$ select api.record_adjustment(%L, '18750100', current_date, gen_random_uuid()) $$, current_setting('t.cash')),
  'adjust cash balance up by 1 ₸'
);
select is(tests.bal('t.cash'), '18750100', 'adjusted balance');

select set_config('t.v1', api.record_revaluation(current_setting('t.usd')::uuid, '510', current_date,
  'a0000000-0000-4000-8000-0000000000b1')::text, true);
select is(
  (select base_amount_minor from public.ledger_lines where entry_id = current_setting('t.v1')::uuid),
  430000::bigint,
  'revaluation to 510: 86 000 USD-minor × 510 − 434 300 ₸ book = 4 300 ₸'
);
select throws_ok(
  format($$ select api.record_revaluation(%L, '1', current_date, gen_random_uuid()) $$, current_setting('t.kaspi')),
  'P0001', 'not_foreign_currency', 'base-currency accounts cannot be revalued'
);

-- ---------- reversals and amendments ----------
select lives_ok(
  format($$ select api.reverse_entry(%L, gen_random_uuid()) $$, current_setting('t.v1')),
  'a revaluation (zero-amount line) can be reversed'
);
select set_config('t.rv', api.reverse_entry(current_setting('t.e1')::uuid,
  'a0000000-0000-4000-8000-0000000000c1')::text, true);
select is(tests.bal('t.cash'), '20000100', 'reversing the cash expense restores the balance');
select is(
  (select occurred_on from public.ledger_entries where id = current_setting('t.rv')::uuid),
  (select occurred_on from public.ledger_entries where id = current_setting('t.e1')::uuid),
  'reversal keeps the original date (R5)'
);
select throws_ok(
  format($$ select api.reverse_entry(%L, gen_random_uuid()) $$, current_setting('t.e1')),
  'P0001', 'already_reversed', 'an entry can be reversed only once'
);
select throws_ok(
  format($$ select api.reverse_entry(%L, gen_random_uuid()) $$, current_setting('t.rv')),
  'P0001', 'cannot_reverse_reversal', 'a reversal cannot be reversed'
);

select set_config('t.am', api.amend_entry(current_setting('t.i1')::uuid,
  jsonb_build_object('kind', 'income', 'account_id', current_setting('t.kaspi'),
                     'amount', '40000000', 'occurred_on', current_date::text),
  'a0000000-0000-4000-8000-0000000000d1')::text, true);
-- 50 000 000 + 1 000 (manual) + 5 030 000 − 1 000 000 − 50 000 000 (reversal) + 40 000 000
select is(tests.bal('t.kaspi'), '44031000', 'amended income replaces the original');
select is(
  api.amend_entry(current_setting('t.i1')::uuid,
    jsonb_build_object('kind', 'income', 'account_id', current_setting('t.kaspi'),
                       'amount', '40000000', 'occurred_on', current_date::text),
    'a0000000-0000-4000-8000-0000000000d1')::text,
  current_setting('t.am'),
  'amend_entry is idempotent'
);

-- ---------- validation ----------
select throws_ok(
  format($$ select api.record_expense(%L, '100', current_date, gen_random_uuid()) $$, current_setting('t.kaspi')),
  'P0001', 'envelope_required', 'budgeted expense needs an envelope'
);
select throws_ok(
  format($$ select api.record_expense(%L, '100', current_date, gen_random_uuid(), gen_random_uuid()) $$,
         current_setting('t.kaspi')),
  'P0001', 'unknown_envelope', 'unknown envelope'
);
select throws_ok(
  format($$ select api.record_expense(%L, '1000000', current_date, gen_random_uuid(), %L) $$,
         current_setting('t.usd'), current_setting('t.needs')),
  'P0001', 'rate_required', 'USD overdraft needs a rate'
);
select throws_ok(
  format($$ select api.record_transfer(%L, %L, '1', '1', current_date, gen_random_uuid()) $$,
         current_setting('t.kaspi'), current_setting('t.kaspi')),
  'P0001', 'same_account', 'transfer to the same account'
);
select throws_ok(
  format($$ select api.record_transfer(%L, %L, '100', '101', current_date, gen_random_uuid()) $$,
         current_setting('t.kaspi'), current_setting('t.cash')),
  'P0001', 'amount_mismatch', 'same-currency transfer amounts must match'
);
select throws_ok(
  format($$ select api.record_income(%L, '0', current_date, gen_random_uuid()) $$, current_setting('t.kaspi')),
  'P0001', 'non_positive_amount', 'zero income'
);
select throws_ok(
  format($$ select api.record_income(%L, '12.5', current_date, gen_random_uuid()) $$, current_setting('t.kaspi')),
  'P0001', 'invalid_amount', 'amounts are integer minor units'
);
select throws_ok(
  format($$ select api.record_income(%L, '100', date '1999-12-31', gen_random_uuid()) $$, current_setting('t.kaspi')),
  'P0001', 'invalid_date', 'dates before 2000 are rejected'
);
select throws_ok(
  format($$ select api.record_income(%L, '100', current_date, null) $$, current_setting('t.kaspi')),
  'P0001', 'idempotency_key_required', 'idempotency key is required'
);

-- ---------- reports ----------
select is(
  (select income_minor from public.monthly_summary where month = date_trunc('month', current_date)::date),
  '90501000',
  'monthly income excludes the reversed original (40 000 000 + 50 500 000 + 1 000)'
);
select is(
  (select expense_minor from public.monthly_summary where month = date_trunc('month', current_date)::date),
  '2020000',
  'monthly expense excludes the reversed expense'
);

-- ---------- more paths (after the report checks, which they would change) ----------
select set_config('t.before', tests.env('unallocated'), true);
select lives_ok(
  $$ select api.create_account('Credit card', 'card', 'KZT', gen_random_uuid(), '-500000') $$,
  'negative opening balance (credit card)'
);
select is(tests.env('unallocated')::bigint, current_setting('t.before')::bigint - 500000,
  'negative opening balance reduces Unallocated');

select set_config('t.before', tests.env('wants'), true);
select lives_ok(
  format($$ select api.record_transfer(%L, %L, '100000', '100000', current_date, gen_random_uuid(),
            p_envelope_id => %L) $$,
         current_setting('t.kaspi'), current_setting('t.broker'), current_setting('t.wants')),
  'transfer out of the budget from a chosen envelope'
);
select is(tests.env('wants')::bigint, current_setting('t.before')::bigint - 100000,
  'the chosen envelope pays for money leaving the budget');

-- USD balance 86 000, book 43 430 000: overdraft of 914 000 at 500 → 43 430 000 + 457 000 000
select set_config('t.e3', api.record_expense(current_setting('t.usd')::uuid, '1000000', current_date,
  gen_random_uuid(), current_setting('t.needs')::uuid, p_fx_rate => '500')::text, true);
select is(
  (select base_amount_minor from public.ledger_lines where entry_id = current_setting('t.e3')::uuid
     and account_id = current_setting('t.usd')::uuid),
  (-500430000)::bigint,
  'overdraft: whole book value plus the excess at the confirmed rate'
);

select lives_ok(
  format($$ select api.reverse_entry(%L, gen_random_uuid()) $$, current_setting('t.t1')),
  'a cross-currency transfer can be reversed'
);

-- custom budgets and the account quota, as a second user
reset role;
insert into auth.users (id, email) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'e@test.local');
select tests.login('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select throws_ok(
  $$ select api.setup_budget('custom', 'KZT',
       '[{"name": "Еда", "allocation_bps": 5000}, {"name": " еда ", "allocation_bps": 5000}]') $$,
  'P0001', 'duplicate_name', 'custom budget: duplicate names (case-insensitive)'
);
select throws_ok(
  $$ select api.setup_budget('custom', 'KZT', '[{"name": "A", "allocation_bps": 9999}]') $$,
  'P0001', 'not_100_percent', 'custom budget: must total 100%'
);
select throws_ok(
  $$ select api.setup_budget('custom', 'KZT', '[{"name": "A", "allocation_bps": 0}, {"name": "B", "allocation_bps": 10000}]') $$,
  'P0001', 'invalid_percentage', 'custom budget: every envelope gets at least 0.01%'
);
select throws_ok(
  $$ select api.setup_budget('custom', 'KZT', '[]') $$,
  'P0001', 'too_few_envelopes', 'custom budget: at least one envelope'
);
select lives_ok(
  $$ select api.setup_budget('custom', 'KZT',
       '[{"name": "Аренда", "allocation_bps": 4000}, {"name": "Подушка", "allocation_bps": 6000, "kind": "savings"}]') $$,
  'valid custom budget'
);
select is(
  (select array_agg(kind::text order by sort_order) from public.envelopes),
  array['custom', 'savings', 'unallocated'],
  'custom envelopes keep their order and kinds'
);
do $$
begin
  for i in 1..50 loop
    perform api.create_account('Account ' || i, 'cash', 'KZT', gen_random_uuid());
  end loop;
end;
$$;
select throws_ok(
  $$ select api.create_account('One too many', 'cash', 'KZT', gen_random_uuid()) $$,
  'P0001', 'account_limit', 'at most 50 accounts per user'
);

-- ---------- invariants (checked as the database owner) ----------
reset role;
select is(private.reconciliation_gap('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'R1: envelopes equal the book value of budgeted accounts');
select is(private.base_drift_count('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
  'base-currency accounts: book value equals balance');
select is(
  (select count(*)::int from (
     select entry_id, currency from public.ledger_lines group by entry_id, currency having sum(amount_minor) <> 0
   ) unbalanced),
  0,
  'L1: every entry sums to zero per currency'
);

-- unauthenticated calls
select set_config('request.jwt.claims', '', true);
select throws_ok(
  format($$ select api.record_income(%L, '100', current_date, gen_random_uuid()) $$, current_setting('t.kaspi')),
  'P0001', 'not_authenticated', 'RPCs require an authenticated user'
);

select is(private.reconciliation_gap('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), 0::bigint, 'R1 for the second user');
select lives_ok('set constraints all immediate', 'deferred L1/E1/R1/has-lines triggers pass at commit');

select * from finish();
rollback;
