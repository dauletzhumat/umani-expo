-- Reference FX rates (migration 0007): privileges and api.fx_rate source selection.
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
-- the single row of api.fx_rate as "rate|source|days_ago" (or null when there is no row)
create function tests.rate(p_from text, p_to text) returns text language sql as $$
  select r.rate || '|' || r.source || '|' || (current_date - r.as_of)
  from api.fx_rate(p_from::char(3), p_to::char(3)) r;
$$;
grant execute on function tests.rate(text, text) to authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@test.local'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@test.local'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'e@test.local');

-- Start from no reference rates, whatever the local database holds (rolled back at the end).
delete from public.reference_rates;

-- ---------- privileges ----------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.reference_rates'::regclass),
  'RLS is enabled on reference_rates'
);
select ok(not has_table_privilege('anon', 'public.reference_rates', 'select'), 'anon cannot read rates');
select ok(has_table_privilege('authenticated', 'public.reference_rates', 'select'), 'users can read rates');
select ok(
  not has_table_privilege('authenticated', 'public.reference_rates', 'insert')
  and not has_table_privilege('authenticated', 'public.reference_rates', 'update')
  and not has_table_privilege('authenticated', 'public.reference_rates', 'delete'),
  'users cannot write rates'
);
select ok(
  has_table_privilege('service_role', 'public.reference_rates', 'insert')
  and has_table_privilege('service_role', 'public.reference_rates', 'update'),
  'the sync function (service role) can upsert rates'
);
select ok(not has_function_privilege('anon', 'api.fx_rate(char, char)', 'execute'), 'anon cannot call fx_rate');
select ok(
  not has_function_privilege('authenticated', 'private.latest_kzt_per_unit(char)', 'execute'),
  'the private helper is not callable by users'
);

select throws_ok(
  $$ insert into public.reference_rates (currency, rate_date, kzt_per_unit) values ('KZT', current_date, 1) $$,
  '23514', null, 'KZT is never stored (it is the cross currency)'
);
select throws_ok(
  $$ insert into public.reference_rates (currency, rate_date, kzt_per_unit) values ('USD', current_date, 0) $$,
  '23514', null, 'rates must be positive'
);

-- ---------- fx_rate without data ----------
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select is(tests.rate('USD', 'USD'), '1|identity|0', 'same currency is 1');
select is(tests.rate('USD', 'KZT'), null, 'no rate at all → no row');
select throws_ok($$ select * from api.fx_rate('XXX', 'KZT') $$, 'P0001', 'unknown_currency', 'unknown currency');

reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from api.fx_rate('USD', 'KZT') $$, 'P0001', 'not_authenticated', 'needs a user');

-- ---------- reference rates only ----------
insert into public.reference_rates (currency, rate_date, kzt_per_unit) values
  ('USD', current_date - 3, 470),
  ('USD', current_date - 1, 475.5),
  ('EUR', current_date - 1, 550),
  ('RUB', current_date - 2, 5.12);

select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select is(tests.rate('USD', 'KZT'), '475.5|nbk|1', 'latest NBK rate, not an older one');
select is(tests.rate('KZT', 'USD'), trim_scale(round(1 / 475.5::numeric, 10))::text || '|nbk|1', 'inverse through KZT');
select is(tests.rate('EUR', 'USD'), trim_scale(round(550 / 475.5::numeric, 10))::text || '|nbk|1', 'cross rate through KZT');
select is(tests.rate('RUB', 'USD'), trim_scale(round(5.12 / 475.5::numeric, 10))::text || '|nbk|2', 'as_of is the older of the two dates');
select is(tests.rate('CNY', 'KZT'), null, 'currency without a reference rate → no row');

-- ---------- the user's own confirmed rate ----------
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'A: budget in KZT');
-- 100.00 USD opened at 480 → book value 48 000.00 KZT, five days ago
select lives_ok(
  $$ select api.create_account('Dollars', 'cash', 'USD', 'a0000000-0000-4000-8000-000000000071',
                               '10000', '480', current_date - 5) $$,
  'A: USD account opened at the user rate 480'
);
select is(tests.rate('USD', 'KZT'), '475.5|nbk|1', 'a newer NBK rate beats an older user rate');

-- 50.00 USD income at 490 today → the user's rate is now the newest
select lives_ok(
  $$ select api.record_income(
       (select id from public.accounts where name = 'Dollars'), '5000', current_date,
       'a0000000-0000-4000-8000-000000000072', null, null, '490') $$,
  'A: USD income at the user rate 490'
);
select is(tests.rate('USD', 'KZT'), '490|user|0', 'the newest user rate wins');
select is(tests.rate('EUR', 'USD'), trim_scale(round(550 / 475.5::numeric, 10))::text || '|nbk|1',
  'user rates only apply to the budget base currency');

-- reversing that income brings the older sources back
select lives_ok(
  $$ select api.reverse_entry(
       (select e.id from public.ledger_entries e where e.kind = 'income'),
       'a0000000-0000-4000-8000-000000000073') $$,
  'A: reverse the 490 income'
);
select is(tests.rate('USD', 'KZT'), '475.5|nbk|1', 'reversed entries are not a source');

-- same day: a tie goes to the user's rate
reset role;
insert into public.reference_rates (currency, rate_date, kzt_per_unit) values ('USD', current_date - 5, 476);
delete from public.reference_rates where currency = 'USD' and rate_date > current_date - 5;
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select is(tests.rate('USD', 'KZT'), '480|user|5', 'same date: the user rate wins the tie');

-- ---------- what counts as the user's rate ----------
select set_config('t.usd', (select id::text from public.accounts where name = 'Dollars'), true);
-- 0.50 USD at 900: under one unit, its rounded book value would give a misleading rate
select lives_ok(
  $$ select api.record_income(current_setting('t.usd')::uuid, '50', current_date,
       'a0000000-0000-4000-8000-000000000074', null, null, '900') $$,
  'A: tiny USD income at 900'
);
select is(tests.rate('USD', 'KZT'), '480|user|5', 'inflows under one unit are ignored');

-- a positive adjustment carries a confirmed rate (balance 100.50 → 200.50 at 485)
select lives_ok(
  $$ select api.record_adjustment(current_setting('t.usd')::uuid, '20050', current_date,
       'a0000000-0000-4000-8000-000000000075', '485') $$,
  'A: positive adjustment at 485'
);
select is(tests.rate('USD', 'KZT'), '485|user|0', 'a positive adjustment is a source');
-- a negative adjustment is valued at the moving average, not at a confirmed rate
select lives_ok(
  $$ select api.record_adjustment(current_setting('t.usd')::uuid, '15050', current_date,
       'a0000000-0000-4000-8000-000000000076') $$,
  'A: negative adjustment'
);
-- a cross-currency transfer into the USD account: 50 000.00 KZT → 100.00 USD (effective 500)
select set_config('t.kzt',
  api.create_account('Tenge', 'card', 'KZT', 'a0000000-0000-4000-8000-000000000077', '10000000')::text, true);
select lives_ok(
  $$ select api.record_transfer(current_setting('t.kzt')::uuid, current_setting('t.usd')::uuid,
       '5000000', '10000', current_date, 'a0000000-0000-4000-8000-000000000078') $$,
  'A: KZT → USD transfer'
);
select is(tests.rate('USD', 'KZT'), '485|user|0', 'negative adjustments and transfers are not sources');

-- ---------- users without the user branch ----------
select tests.login('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select is(tests.rate('USD', 'KZT'), '476|nbk|5', 'no active budget → reference rate only');

-- base currency other than KZT: the user's EUR → USD rate, newer than the crossed NBK date
select tests.login('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select lives_ok($$ select api.setup_budget('50_30_20', 'USD') $$, 'D: budget in USD');
select lives_ok(
  $$ select api.create_account('Euro', 'cash', 'EUR', 'd0000000-0000-4000-8000-000000000071',
                               '10000', '1.1', current_date) $$,
  'D: EUR account opened at 1.1 USD'
);
select is(tests.rate('EUR', 'USD'), '1.1|user|0', 'user rate into a non-KZT base');
select is(tests.rate('EUR', 'KZT'), '550|nbk|1', 'other targets still use the reference rate');

-- ---------- currencies with different minor units ----------
reset role;
insert into public.currencies (code, minor_units, symbol) values ('JPY', 0, '¥');
insert into public.reference_rates (currency, rate_date, kzt_per_unit) values ('JPY', current_date - 1, 3.1);
select tests.login('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select is(tests.rate('JPY', 'KZT'), '3.1|nbk|1', 'reference rate for a 0-decimal currency');
select is(tests.rate('KZT', 'JPY'), trim_scale(round(1 / 3.1, 10))::text || '|nbk|1', 'and its inverse');
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'E: budget in KZT');
-- 10 000 JPY at 3.05 → book value 30 500.00 KZT (3 050 000 minor units)
select lives_ok(
  $$ select api.create_account('Yen', 'cash', 'JPY', 'e0000000-0000-4000-8000-000000000071',
                               '10000', '3.05', current_date) $$,
  'E: JPY account opened at 3.05'
);
select is(tests.rate('JPY', 'KZT'), '3.05|user|0', 'minor units are scaled when deriving the user rate');

-- ---------- RLS as the user, not only privileges ----------
select tests.login('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select ok((select count(*) from public.reference_rates) > 0, 'a user reads reference rates');
select throws_ok(
  $$ insert into public.reference_rates (currency, rate_date, kzt_per_unit) values ('EUR', current_date, 500) $$,
  '42501', null, 'a user cannot insert rates'
);
select throws_ok(
  $$ update public.reference_rates set kzt_per_unit = 1 $$,
  '42501', null, 'a user cannot update rates'
);

-- ---------- isolation ----------
select tests.login('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select lives_ok($$ select api.setup_budget('50_30_20', 'KZT') $$, 'B: budget in KZT');
select is(tests.rate('USD', 'KZT'), '476|nbk|5', 'B never sees A''s rates');

select * from finish();
rollback;
