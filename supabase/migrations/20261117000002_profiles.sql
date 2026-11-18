-- UMANI 0002: profiles (DATABASE.md §3)

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text check (display_name is null or char_length(display_name) <= 100),
  locale        text not null default 'ru' check (locale in ('ru', 'kk', 'en')),
  timezone      text not null default 'Asia/Almaty' check (char_length(timezone) <= 64),
  base_currency char(3) not null default 'KZT' references public.currencies (code),
  theme         text not null default 'system' check (theme in ('system', 'light', 'dark')),
  onboarded_at  timestamptz,
  ai_consent_at timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Users may change only these columns directly; everything else goes through RPCs.
-- ai_consent_at is a consent record, so it is set only by api.set_ai_consent (server time).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, locale, timezone, theme) on public.profiles to authenticated;

-- A timezone must be a real IANA name, or later `at time zone` conversions would fail.
create function private.check_profile_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    perform private.fail('invalid_timezone');
  end if;
  return new;
end;
$$;

create trigger profiles_timezone_valid
  before insert or update of timezone on public.profiles
  for each row execute function private.check_profile_timezone();

-- A profile row is created for every new auth user.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ''), 100)
  );
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;
revoke execute on function private.check_profile_timezone() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
