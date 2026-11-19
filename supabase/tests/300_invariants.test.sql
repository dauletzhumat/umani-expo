-- Database-enforced invariants, independent of the RPCs (DATABASE.md §3, §5a, §7).
-- Each violation is attempted inside its own savepoint so no pending deferred check leaks
-- into the next case.
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

insert into auth.users (id, email) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@test.local');
select tests.login('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select api.setup_budget('50_30_20', 'KZT');
select set_config('t.cash', api.create_account('Cash', 'cash', 'KZT', gen_random_uuid(), '1000')::text, true);
select set_config('t.usd', api.create_account('USD', 'card', 'USD', gen_random_uuid())::text, true);
select set_config('t.needs', (select id::text from public.envelopes where kind = 'needs'), true);
select set_config('t.budget', (select id::text from public.budgets), true);
select set_config('t.entry', (select id::text from public.ledger_entries limit 1), true);
select set_config('t.line', (select id::text from public.ledger_lines limit 1), true);
reset role;
select set_config('t.sys', (select id::text from public.accounts where kind = 'system' and user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' limit 1), true);
select lives_ok('set constraints all immediate', 'RPC-written data passes every deferred check');
-- SET CONSTRAINTS lasts for the rest of the transaction; go back to commit-time checks.
set constraints all deferred;

-- direct writes below run as the table owner: only triggers and constraints stand in the way

-- ---------- append-only ----------
select throws_ok(
  format($$ update public.ledger_lines set amount_minor = 1 where id = %L $$, current_setting('t.line')),
  'P0001', 'ledger_append_only', 'ledger lines cannot be updated'
);
select throws_ok(
  format($$ update public.ledger_entries set note = 'x' where id = %L $$, current_setting('t.entry')),
  'P0001', 'ledger_append_only', 'ledger entries cannot be updated'
);
select throws_ok(
  format($$ delete from public.ledger_entries where id = %L $$, current_setting('t.entry')),
  'P0001', 'ledger_append_only', 'ledger entries cannot be deleted'
);
select throws_ok('truncate public.ledger_lines', 'P0001', 'ledger_append_only', 'ledger lines cannot be truncated');
select throws_ok('truncate public.envelope_lines', 'P0001', 'ledger_append_only', 'envelope lines cannot be truncated');

-- ---------- line shape (immediate triggers) ----------
savepoint shape;
insert into public.ledger_entries (id, user_id, kind, occurred_on, idempotency_key, request_hash)
values ('e0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'income',
        current_date, gen_random_uuid(), '\x00');
select throws_ok(
  format($$ insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
            values ('e0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', %L, 1, 'USD', 1) $$,
         current_setting('t.cash')),
  'P0001', 'currency_mismatch', 'line currency must equal the account currency'
);
select throws_ok(
  format($$ insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
            values ('e0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', %L, 1, 'KZT', null) $$,
         current_setting('t.cash')),
  'P0001', 'base_missing', 'user-account lines need a base amount'
);
select throws_ok(
  format($$ insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
            values ('e0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', %L, 1, 'KZT', 1) $$,
         current_setting('t.sys')),
  'P0001', 'base_on_system_line', 'system-account lines carry no base amount'
);
select throws_ok(
  format($$ insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
            values ('e0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', %L, 0, 'KZT', 0) $$,
         current_setting('t.cash')),
  'P0001', 'zero_line', 'zero-amount lines only in revaluations'
);
select throws_ok(
  format($$ insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
            values ('e0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', %L, 100, 'KZT', 99) $$,
         current_setting('t.cash')),
  'P0001', 'base_amount_mismatch', 'base-currency accounts: base amount equals amount'
);
insert into auth.users (id, email) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@test.local');
select throws_ok(
  format($$ insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
            values ('e0000000-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', %L, 1, 'KZT', 1) $$,
         current_setting('t.cash')),
  '23503', null, 'a line cannot reference another user''s entry or account'
);
rollback to savepoint shape;

-- ---------- deferred checks (fire at commit; forced here with SET CONSTRAINTS) ----------
savepoint empty_entry;
insert into public.ledger_entries (user_id, kind, occurred_on, idempotency_key, request_hash)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'income', current_date, gen_random_uuid(), '\x00');
select throws_ok('set constraints all immediate', 'P0001', 'empty_entry', 'an entry without lines is rejected');
rollback to savepoint empty_entry;

savepoint unbalanced;
insert into public.ledger_entries (id, user_id, kind, occurred_on, idempotency_key, request_hash)
values ('e0000000-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'income',
        current_date, gen_random_uuid(), '\x00');
insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor)
values ('e0000000-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        current_setting('t.cash')::uuid, 100, 'KZT', 100);
select throws_ok('set constraints all immediate', 'P0001', 'unbalanced', 'L1: an unbalanced entry is rejected');
rollback to savepoint unbalanced;

savepoint r1;
-- balanced in money (cash +100 / system −100) but no envelope lines: budget and accounts disagree
insert into public.ledger_entries (id, user_id, kind, occurred_on, idempotency_key, request_hash)
values ('e0000000-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'adjustment',
        current_date, gen_random_uuid(), '\x00');
insert into public.ledger_lines (entry_id, user_id, account_id, amount_minor, currency, base_amount_minor) values
  ('e0000000-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_setting('t.cash')::uuid, 100, 'KZT', 100),
  ('e0000000-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_setting('t.sys')::uuid, -100, 'KZT', null);
select throws_ok('set constraints all immediate', 'P0001', 'reconciliation_gap',
  'R1: envelopes must equal the book value of budgeted accounts');
rollback to savepoint r1;

savepoint allocation;
insert into public.ledger_entries (id, user_id, kind, occurred_on, idempotency_key, request_hash)
values ('e0000000-0000-4000-8000-000000000004', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'allocation',
        current_date, gen_random_uuid(), '\x00');
insert into public.envelope_lines (entry_id, user_id, envelope_id, amount_minor)
values ('e0000000-0000-4000-8000-000000000004', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        current_setting('t.needs')::uuid, 5);
select throws_ok('set constraints all immediate', 'P0001', 'allocation_unbalanced',
  'E1: allocations cannot create budget');
rollback to savepoint allocation;

-- ---------- immutable columns ----------
select throws_ok(
  format($$ update public.accounts set currency = 'EUR' where id = %L $$, current_setting('t.usd')),
  'P0001', 'currency_immutable', 'account currency cannot change'
);
select throws_ok(
  format($$ update public.budgets set base_currency = 'USD' where id = %L $$, current_setting('t.budget')),
  'P0001', 'base_currency_immutable', 'budget base currency cannot change (R7)'
);

-- ---------- account deletion ----------
select tests.login('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select throws_ok(
  $$ select api.purge_account('cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'users cannot call purge_account'
);
select throws_ok(
  $$ select private.purge_user('cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'users cannot reach private.purge_user'
);
select set_config('umani.purge_user', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
select throws_ok(
  format($$ delete from public.ledger_entries where id = %L $$, current_setting('t.entry')),
  '42501', null, 'setting the purge flag from a client session achieves nothing'
);
select set_config('umani.purge_user', '', true);
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select lives_ok(
  $$ select api.purge_account('cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  'the delete-account path (service role) removes a user'
);
reset role;

select is(
  (select count(*)::int from public.ledger_entries where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  + (select count(*)::int from public.ledger_lines where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  + (select count(*)::int from public.envelope_lines where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  + (select count(*)::int from public.accounts where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  + (select count(*)::int from public.budgets where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  + (select count(*)::int from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  + (select count(*)::int from auth.users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  0,
  'all of the user''s rows are gone'
);
select is(current_setting('umani.purge_user', true), '', 'purge flag is cleared afterwards');

select * from finish();
rollback;
