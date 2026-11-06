-- =============================================================================
-- 0001 Foundation: private helper schema, enums, shared trigger functions.
--
-- Everything in the `app` schema is internal. It is not exposed through the
-- API, so these helpers can only be reached from policies, triggers and the
-- public functions defined in later migrations.
-- =============================================================================

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enumerated values
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('artist', 'manager');
create type public.phone_type as enum ('iphone', 'android', 'unknown');
create type public.order_status as enum ('open', 'finished', 'closed');
create type public.order_event_type as enum ('created', 'finished', 'closed', 'reopened');
create type public.purchase_status as enum ('pending', 'approved', 'rejected');
create type public.studio_time_category as enum (
  'cleanup_maintenance',   -- cleanup and maintenance
  'general_prep',          -- general prep not tied to an order
  'admin_teaching_other'   -- admin, teaching or other
);
create type public.task_priority as enum ('high', 'normal', 'low');
create type public.task_status as enum ('open', 'done');
create type public.task_recurrence as enum ('daily', 'weekly', 'biweekly', 'monthly');
create type public.personal_item_status as enum ('open', 'approved', 'done');
create type public.calendar_connection_status as enum ('disconnected', 'connected', 'error');
create type public.attendee_response as enum ('accepted', 'declined', 'tentative', 'needs_action');

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Today's date in the studio's time zone, so "7 days after the work date" and
-- "defaults to today" behave the same at 11 pm in Chicago as at noon.
create or replace function app.today()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Chicago')::date
$$;

-- (The role checks is_manager and is_active_user are defined in migration 0002,
--  right after the profiles table they read from.)

-- Artists may add or change their own entries only within this window.
create or replace function app.within_edit_window(p_work_date date)
returns boolean
language sql
stable
as $$
  select p_work_date <= app.today()
     and p_work_date >= app.today() - 7
$$;

-- Generic "who touched this last" stamp. Attached as a BEFORE UPDATE trigger
-- on every table that carries edited_by / edited_at.
create or replace function app.set_edited()
returns trigger
language plpgsql
as $$
begin
  new.edited_by := auth.uid();
  new.edited_at := now();
  return new;
end
$$;

-- Is the current request coming from a signed-in app user (as opposed to the
-- service role used by seed scripts and scheduled jobs, or a direct admin
-- connection)?  Triggers use this so admin tooling is not blocked.
create or replace function app.is_app_user()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), '') = 'authenticated'
$$;
