-- =============================================================================
-- 0010 Harden new accounts.
--
-- The app's public key is visible to anyone who opens the site.  If Supabase's
-- public sign-up were left on, a stranger could create an account, and until
-- now that account would have been an *active* artist able to read designs,
-- orders, entries and everyone's name.
--
-- Two changes close that gap at the database level (the Auth setting
-- "Allow new users to sign up" is switched off as well; the privacy test
-- checks it):
--   1. A brand-new account starts inactive.  A manager (or the seed script)
--      switches it on.  Every shared-table policy already requires an active
--      account, so an inactive one sees nothing.
--   2. The `people` view (names and roles) is readable only by active accounts.
-- =============================================================================

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    'artist',
    false
  );
  return new;
end
$$;

create or replace view public.people as
  select id, full_name, role, active
  from public.profiles
  where (select app.is_active_user());
