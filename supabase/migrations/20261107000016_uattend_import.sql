-- =============================================================================
-- 0016 uAttend import (session 4).
--
--   A manager uploads uAttend's Timecard Report (the export with one block per
--   person and one line per day or punch).  The browser reads the file and shows
--   a preview; saving calls import_uattend, which writes everything in one
--   transaction, so an upload is either saved whole or not at all.
--
--   1. uattend_names remembers how uAttend spells each person's name and who
--      that is in the tracker, or that the name is not anyone in the tracker.
--      Next time the same spelling is matched automatically.  Manager-only.
--   2. Every day of the period, up to the upload date, gets a row for each
--      matched person: 0 minutes on a day with no punches.  So "did not clock
--      in" (a row with 0) is different from "not imported yet" (no row).
--   3. A day with a punch that has no clock-out (or no clock-in) is kept as a
--      missing punch.  Its minutes stay empty unless uAttend gave a total, so
--      it shows as missing, never as zero.
--   4. Uploading the same period again replaces those days for the people in
--      the file; it never adds a second copy.  People not in the file keep
--      what they have.
--   5. set_uattend_match fixes a wrong match afterwards: the days that came
--      from that spelling move to the right person, or are removed when the
--      name is not anyone in the tracker.
--
--   No pay figure from the file is read or stored.  The export has a Gross Pay
--   line; the browser skips it before anything reaches the database.
-- =============================================================================

-- How names are compared: trimmed, inner spaces collapsed, lower case.
-- uAttend writes "Joe  Waropay" with two spaces; this treats it as one.
create or replace function app.uattend_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

-- -----------------------------------------------------------------------------
-- uattend_names — manager-only.  One row per uAttend spelling.
-- -----------------------------------------------------------------------------
create table public.uattend_names (
  name_key     text primary key,
  uattend_name text not null,
  profile_id   uuid references public.profiles (id),   -- null: not in the tracker, skipped
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  edited_by    uuid references public.profiles (id),
  edited_at    timestamptz,
  constraint uattend_names_key check (name_key <> '' and name_key = app.uattend_key(uattend_name))
);

create index uattend_names_profile on public.uattend_names (profile_id);

alter table public.uattend_names enable row level security;

create policy "uattend_names: managers read"
  on public.uattend_names for select to authenticated
  using ((select app.is_manager()));

create policy "uattend_names: managers insert"
  on public.uattend_names for insert to authenticated
  with check ((select app.is_manager()));

create policy "uattend_names: managers update"
  on public.uattend_names for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy "uattend_names: managers delete"
  on public.uattend_names for delete to authenticated
  using ((select app.is_manager()));

create trigger uattend_names_set_edited
  before update on public.uattend_names
  for each row execute function app.set_edited();

-- -----------------------------------------------------------------------------
-- uattend_days — which spelling each day came from, and missing punches.
-- -----------------------------------------------------------------------------
alter table public.uattend_days
  add column name_key text,
  add column missing_punch boolean not null default false,
  alter column clocked_minutes drop not null,
  add constraint uattend_days_minutes_or_missing check (clocked_minutes is not null or missing_punch);

create index uattend_days_name on public.uattend_days (name_key, work_date);
create index uattend_days_date on public.uattend_days (work_date);
create index uattend_days_import on public.uattend_days (import_id);

-- -----------------------------------------------------------------------------
-- uattend_imports — what each upload did, for the import history.
-- -----------------------------------------------------------------------------
alter table public.uattend_imports
  add column people_count       integer,
  add column skipped_names      text[] not null default '{}',
  add column missing_punch_days integer not null default 0;

-- -----------------------------------------------------------------------------
-- import_uattend — managers only.  Saves one previewed upload.
--
--   p_people is a list, one item per person in the file:
--     { "name": "Joseph Wallander",
--       "profile_id": "<uuid>" or null (not in the tracker),
--       "days": [ { "date": "2026-11-02", "minutes": 496, "missing_punch": false }, ... ] }
--   Only days with punches or hours need to be listed; the rest of the period
--   (up to today) is filled in with 0.
-- -----------------------------------------------------------------------------
create or replace function public.import_uattend(
  p_file_name   text,
  p_period_from date,
  p_period_to   date,
  p_people      jsonb
)
returns public.uattend_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import  public.uattend_imports;
  v_person  jsonb;
  v_day     jsonb;
  v_name    text;
  v_key     text;
  v_profile uuid;
  v_seen    uuid[] := '{}';
  v_keys    text[] := '{}';
  v_skipped text[] := '{}';
  v_people  integer := 0;
  v_days    integer := 0;
  v_rows    integer;
  v_last    date;
  v_date    date;
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can import uAttend hours' using errcode = '42501';
  end if;
  if p_period_from is null or p_period_to is null or p_period_from > p_period_to then
    raise exception 'The pay period in the file could not be read';
  end if;
  if p_period_to - p_period_from > 31 then
    raise exception 'Upload at most one month at a time (this file covers % days)', p_period_to - p_period_from + 1;
  end if;
  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
    raise exception 'The file has nobody in it';
  end if;

  insert into public.uattend_imports (file_name, period_from, period_to, uploaded_by)
  values (left(p_file_name, 200), p_period_from, p_period_to, auth.uid())
  returning * into v_import;

  -- Days after today are not known yet, so they are not filled in with 0.
  v_last := least(p_period_to, app.today());

  for v_person in select * from jsonb_array_elements(p_people) loop
    v_name := btrim(regexp_replace(coalesce(v_person ->> 'name', ''), '\s+', ' ', 'g'));
    v_key := app.uattend_key(v_name);
    if v_key = '' then
      raise exception 'A person in the file has no name';
    end if;
    if v_key = any (v_keys) then
      raise exception '% appears twice in the file', v_name;
    end if;
    v_keys := v_keys || v_key;

    v_profile := nullif(v_person ->> 'profile_id', '')::uuid;
    if v_profile is not null then
      if not exists (select 1 from public.profiles p where p.id = v_profile) then
        raise exception 'The tracker person chosen for % no longer exists', v_name;
      end if;
      if v_profile = any (v_seen) then
        raise exception 'Two names in the file are matched to the same tracker person (% is one of them). Match each person once.', v_name;
      end if;
      v_seen := v_seen || v_profile;
    end if;

    -- Remember the match for next time.
    insert into public.uattend_names as n (name_key, uattend_name, profile_id)
    values (v_key, v_name, v_profile)
    on conflict (name_key) do update
      set uattend_name = excluded.uattend_name, profile_id = excluded.profile_id
      where n.uattend_name is distinct from excluded.uattend_name
         or n.profile_id is distinct from excluded.profile_id;

    -- Replace, never duplicate: clear the period for this spelling and this person.
    delete from public.uattend_days d
    where d.work_date between p_period_from and p_period_to
      and (d.name_key = v_key or (v_profile is not null and d.artist_id = v_profile));

    if v_profile is null then
      v_skipped := v_skipped || v_name;
      continue;
    end if;
    v_people := v_people + 1;

    for v_day in select * from jsonb_array_elements(coalesce(v_person -> 'days', '[]'::jsonb)) loop
      v_date := (v_day ->> 'date')::date;
      if v_date is null or v_date < p_period_from or v_date > p_period_to then
        raise exception '% has a day (%) outside the pay period', v_name, coalesce(v_date::text, 'no date');
      end if;
      if (v_day ->> 'minutes') is not null and (v_day ->> 'minutes')::integer < 0 then
        raise exception '% has negative hours on %', v_name, v_date;
      end if;
    end loop;

    insert into public.uattend_days (artist_id, work_date, clocked_minutes, missing_punch, import_id, name_key)
    select v_profile,
           g.day::date,
           case
             when d.day is null then 0
             when d.missing then d.minutes
             else coalesce(d.minutes, 0)
           end,
           coalesce(d.missing, false),
           v_import.id,
           v_key
    from generate_series(p_period_from, p_period_to, interval '1 day') as g(day)
    left join (
      select (x ->> 'date')::date as day,
             (x ->> 'minutes')::integer as minutes,
             coalesce((x ->> 'missing_punch')::boolean, false) as missing
      from jsonb_array_elements(coalesce(v_person -> 'days', '[]'::jsonb)) as x
    ) d on d.day = g.day::date
    where g.day::date <= v_last or d.day is not null;

    get diagnostics v_rows = row_count;
    v_days := v_days + v_rows;
  end loop;

  update public.uattend_imports i
  set row_count = v_days,
      people_count = v_people,
      skipped_names = v_skipped,
      missing_punch_days = (select count(*) from public.uattend_days d where d.import_id = v_import.id and d.missing_punch)
  where i.id = v_import.id
  returning * into v_import;

  return v_import;
end
$$;

-- -----------------------------------------------------------------------------
-- set_uattend_match — managers only.  Fixes a match after an import.
-- -----------------------------------------------------------------------------
create or replace function public.set_uattend_match(p_uattend_name text, p_profile_id uuid)
returns public.uattend_names
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key   text := app.uattend_key(p_uattend_name);
  v_row   public.uattend_names;
  v_clash date;
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can change a uAttend match' using errcode = '42501';
  end if;

  select * into v_row from public.uattend_names n where n.name_key = v_key for update;
  if not found then
    raise exception 'No uAttend name "%" has been imported yet', p_uattend_name;
  end if;
  if p_profile_id is not null and not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception 'That tracker person does not exist';
  end if;

  if p_profile_id is null then
    delete from public.uattend_days d where d.name_key = v_key;
  else
    select d.work_date into v_clash
    from public.uattend_days d
    join public.uattend_days o
      on o.artist_id = p_profile_id
     and o.work_date = d.work_date
     and o.name_key is distinct from v_key
    where d.name_key = v_key
    order by d.work_date
    limit 1;
    if found then
      raise exception 'That person already has uAttend hours on % from a different uAttend name. Change that match first.',
        to_char(v_clash, 'FMMon FMDD, YYYY');
    end if;
    update public.uattend_days d set artist_id = p_profile_id where d.name_key = v_key;
  end if;

  update public.uattend_names n
  set profile_id = p_profile_id
  where n.name_key = v_key
  returning * into v_row;

  return v_row;
end
$$;
