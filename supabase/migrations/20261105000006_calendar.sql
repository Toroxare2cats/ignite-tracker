-- =============================================================================
-- 0006 Google Calendar (read-only sync): calendar_connection, calendar_events,
--      calendar_attendees, calendar_ignored_emails.
--
-- Tables only.  The connection itself (Google Cloud project, consent screen,
-- sync job) is session 8.  The access key is never stored in any table; it
-- lives in Supabase's secrets store and is read only by the sync function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- calendar_connection â€” a single row of status and settings.  Managers read
-- and update; artists have no access.
-- -----------------------------------------------------------------------------
create table public.calendar_connection (
  id                 integer primary key default 1 check (id = 1),
  account_email      text,
  status             public.calendar_connection_status not null default 'disconnected',
  selected_calendars jsonb not null default '[]'::jsonb,   -- [{ "id": "...", "name": "Flame Shop" }, ...]
  last_sync_at       timestamptz,
  last_error         text,
  connected_by       uuid references public.profiles (id),
  connected_at       timestamptz,
  edited_by          uuid references public.profiles (id),
  edited_at          timestamptz
);

insert into public.calendar_connection (id) values (1);

alter table public.calendar_connection enable row level security;

create policy "calendar_connection: managers read"
  on public.calendar_connection for select to authenticated
  using ((select app.is_manager()));

create policy "calendar_connection: managers update"
  on public.calendar_connection for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create trigger calendar_connection_set_edited
  before update on public.calendar_connection
  for each row execute function app.set_edited();

-- -----------------------------------------------------------------------------
-- calendar_events â€” what is stored: title, start, end, calendar name,
-- all-day flag.  Descriptions and locations are never stored.
-- Written by the sync job only (service role); no user insert policy.
-- -----------------------------------------------------------------------------
create table public.calendar_events (
  id              uuid primary key default gen_random_uuid(),
  calendar_id     text not null,
  calendar_name   text not null,
  google_event_id text not null,
  title           text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  all_day         boolean not null default false,
  cancelled       boolean not null default false,
  synced_at       timestamptz not null default now(),
  unique (calendar_id, google_event_id)
);

create index calendar_events_start on public.calendar_events (starts_at);

alter table public.calendar_events enable row level security;

-- -----------------------------------------------------------------------------
-- calendar_attendees â€” invited email, response, matched person.
-- Artists see only their own rows.  Managers may update the match.
-- (Created before the events policy, which needs to look rows up here.)
-- -----------------------------------------------------------------------------
create table public.calendar_attendees (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.calendar_events (id) on delete cascade,
  email      text not null,
  response   public.attendee_response not null default 'needs_action',
  profile_id uuid references public.profiles (id),      -- blank if unmatched
  unique (event_id, email)
);

create index calendar_attendees_profile on public.calendar_attendees (profile_id);
create index calendar_attendees_email on public.calendar_attendees (lower(email));

alter table public.calendar_attendees enable row level security;

-- Is the signed-in user an invitee on this event?
create or replace function app.is_matched_to_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.calendar_attendees a
    where a.event_id = p_event_id
      and a.profile_id = auth.uid()
  )
$$;

create policy "calendar_events: matched or manager read"
  on public.calendar_events for select to authenticated
  using ((select app.is_manager()) or app.is_matched_to_event(id));

create policy "calendar_attendees: own or manager read"
  on public.calendar_attendees for select to authenticated
  using ((select app.is_manager()) or profile_id = auth.uid());

create policy "calendar_attendees: managers update match"
  on public.calendar_attendees for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

-- -----------------------------------------------------------------------------
-- calendar_ignored_emails â€” invite addresses a manager chose to ignore in the
-- Unmatched invitees list.  Manager-only.
-- -----------------------------------------------------------------------------
create table public.calendar_ignored_emails (
  email      text primary key,
  ignored_by uuid references public.profiles (id) default auth.uid(),
  ignored_at timestamptz not null default now()
);

alter table public.calendar_ignored_emails enable row level security;

create policy "calendar_ignored_emails: managers read"
  on public.calendar_ignored_emails for select to authenticated
  using ((select app.is_manager()));

create policy "calendar_ignored_emails: managers insert"
  on public.calendar_ignored_emails for insert to authenticated
  with check ((select app.is_manager()));

create policy "calendar_ignored_emails: managers delete"
  on public.calendar_ignored_emails for delete to authenticated
  using ((select app.is_manager()));
