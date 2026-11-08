-- =============================================================================
-- 0014 People: three guards, added before managers start managing accounts.
--
--   1. Alternate emails are manager-only.  Until now a person could edit their
--      own list, and the calendar sync (session 8) uses that list to decide
--      whose event an invitation is.
--   2. A manager cannot deactivate their own account or change their own role,
--      so the studio can never be left with no active manager.
--   3. A deactivated account's pay rates are frozen as they were (brief:
--      Accounts).
-- =============================================================================

create or replace function app.protect_profile_fields()
returns trigger
language plpgsql
as $$
begin
  if app.is_app_user() then
    if not (select app.is_manager()) then
      if new.role             is distinct from old.role
      or new.active           is distinct from old.active
      or new.email            is distinct from old.email
      or new.id               is distinct from old.id
      or new.full_name        is distinct from old.full_name
      or new.alternate_emails is distinct from old.alternate_emails
      then
        raise exception 'Only a manager can change a role, active flag, login email, alternate emails or name'
          using errcode = '42501';
      end if;
    elsif new.id = auth.uid()
      and (new.active is distinct from old.active or new.role is distinct from old.role)
    then
      raise exception 'You cannot deactivate your own account or change your own role. Ask another manager.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create or replace function app.block_rate_for_inactive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_app_user()
    and not exists (select 1 from public.profiles p where p.id = new.profile_id and p.active)
  then
    raise exception 'This account is deactivated, so its pay rates are frozen'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger pay_rates_active_accounts_only
  before insert on public.pay_rates
  for each row execute function app.block_rate_for_inactive();
