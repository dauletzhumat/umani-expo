-- UMANI 0010: savings goals (PRD BUD-7; DATABASE.md §3 savings_goals, §8 set_savings_goal).
-- Deposit accounts for the planner (DEP-3) use api.create_account with p_kind 'deposit' and
-- p_linked_envelope_id; contributions are ordinary transfers (DEP-4). Nothing new is needed there.

/**
 * Set (or change) the goal of a savings envelope: a target in the budget base currency and an
 * optional target date. One active goal per envelope, so this is an upsert and a retry is harmless.
 * p_target_date null clears the date.
 */
create function api.set_savings_goal(p_envelope_id uuid, p_target text, p_target_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  bud public.budgets;
  amt bigint;
  v_id uuid;
begin
  amt := private.parse_amount(p_target);
  if amt <= 0 then
    perform private.fail('non_positive_amount');
  end if;
  -- the server runs in UTC: allow one day of slack so "today" in the user's time zone is accepted
  if p_target_date is not null and p_target_date < current_date - 1 then
    perform private.fail('invalid_date');
  end if;
  bud := private.active_budget(uid);
  -- goals belong to savings envelopes (BUD-7): active, in the active budget, kind savings
  if p_envelope_id is null or not exists (
    select 1 from public.envelopes
    where id = p_envelope_id and user_id = uid and budget_id = bud.id
      and archived_at is null and kind = 'savings'
  ) then
    perform private.fail('unknown_envelope');
  end if;
  -- serialise this user's goal changes (same helper as categories and limits)
  perform private.lock_user_scope(uid, 'goals');

  insert into public.savings_goals (user_id, envelope_id, target_minor, target_date)
  values (uid, p_envelope_id, amt, p_target_date)
  on conflict (envelope_id) where archived_at is null
  do update set target_minor = excluded.target_minor, target_date = excluded.target_date
  returning id into v_id;
  return v_id;
end;
$$;

/** Stop tracking a goal; archiving twice is a no-op. The envelope and its money are untouched. */
create function api.archive_savings_goal(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  update public.savings_goals set archived_at = coalesce(archived_at, now())
  where id = p_goal_id and user_id = uid;
  if not found then
    perform private.fail('unknown_goal');
  end if;
end;
$$;

/**
 * A goal belongs to an active savings envelope: when an envelope is archived (method switch) or
 * stops being a savings envelope, its goal is archived with it, so no orphan goals are shown.
 * SECURITY DEFINER like every trigger function here (DATABASE §8).
 */
create function private.archive_goals_of_envelope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null or new.kind <> 'savings' then
    update public.savings_goals set archived_at = now()
    where envelope_id = new.id and user_id = new.user_id and archived_at is null;
  end if;
  return new;
end;
$$;

create trigger envelopes_archive_goals
  after update of archived_at, kind on public.envelopes
  for each row
  when (new.archived_at is distinct from old.archived_at or new.kind is distinct from old.kind)
  execute function private.archive_goals_of_envelope();

revoke execute on function private.archive_goals_of_envelope() from public, anon, authenticated;
revoke execute on function api.set_savings_goal(uuid, text, date) from public, anon;
revoke execute on function api.archive_savings_goal(uuid) from public, anon;
grant execute on function api.set_savings_goal(uuid, text, date) to authenticated;
grant execute on function api.archive_savings_goal(uuid) to authenticated;
