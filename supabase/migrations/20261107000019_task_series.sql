-- =============================================================================
-- 0019 Managing tasks: repeating series, saving, reopening.
--
-- * Each task belongs to a series (a one-off task is a series of one).  The
--   database refuses a second open task in the same series, so a repeating
--   task can never have two open occurrences (brief: "Only one occurrence is
--   open at a time").
-- * The next occurrence keeps the schedule's day and skips dates already past
--   (Arvin, 2026-11-07): a weekly task due Monday Nov 2 that is done on
--   Wednesday Nov 11 comes back on Monday Nov 16.  Monthly keeps the day of
--   the month where it can (Jan 31 -> Feb 28 -> Mar 31).
-- * save_task creates or edits a task and its assignees in one step
--   (managers only).  A repeating task needs a first due date.
-- * reopen_task (managers only) puts a done task back to open and takes back
--   the next occurrence its completion created, if that one is still open.
--
-- No money anywhere (rules 1 and 12).
-- =============================================================================

alter table public.tasks
  add column series_id    uuid,
  add column series_start date;

comment on column public.tasks.series_id is 'The first task of a repeating series (a one-off task is its own series).';
comment on column public.tasks.series_start is 'The date a repeating schedule counts from; reset when a manager changes the due date or the repeat.';

-- Existing rows: follow previous_task_id back to the first task of each chain.
alter table public.tasks disable trigger user;

with recursive chain as (
  select id, id as root from public.tasks where previous_task_id is null
  union all
  select t.id, c.root from public.tasks t join chain c on t.previous_task_id = c.id
)
update public.tasks t set series_id = c.root from chain c where c.id = t.id;

update public.tasks set series_id = id where series_id is null;

update public.tasks t
set series_start = coalesce(
  (select f.due_date from public.tasks f where f.id = t.series_id),
  t.due_date,
  t.created_at::date)
where t.recurrence is not null;

alter table public.tasks enable trigger user;

alter table public.tasks alter column series_id set not null;

create unique index tasks_one_open_per_series on public.tasks (series_id) where status = 'open';
create index tasks_series on public.tasks (series_id);
create index tasks_previous on public.tasks (previous_task_id);

-- -----------------------------------------------------------------------------
-- Keep series_id and series_start right on every insert and update.
-- -----------------------------------------------------------------------------
create or replace function app.task_series()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.series_id := coalesce(new.series_id, new.id);
    if new.recurrence is not null and new.series_start is null then
      new.series_start := coalesce(new.due_date, app.today());
    end if;
    return new;
  end if;

  new.series_id := old.series_id;   -- never changes
  if new.recurrence is not null
  and (new.due_date is distinct from old.due_date or new.recurrence is distinct from old.recurrence) then
    new.series_start := coalesce(new.due_date, app.today());
  end if;
  return new;
end
$$;

create trigger tasks_series
  before insert or update on public.tasks
  for each row execute function app.task_series();

-- -----------------------------------------------------------------------------
-- The next date on a repeating schedule that is after both the task's due
-- date and today.
-- -----------------------------------------------------------------------------
create or replace function app.next_task_date(
  p_start      date,
  p_recurrence public.task_recurrence,
  p_due        date
)
returns date
language plpgsql
stable
as $$
declare
  v_after date := greatest(coalesce(p_due, app.today()), app.today());
  v_step  interval := case p_recurrence
    when 'daily'    then interval '1 day'
    when 'weekly'   then interval '7 days'
    when 'biweekly' then interval '14 days'
    when 'monthly'  then interval '1 month'
  end;
  v_k     integer;
  v_next  date;
begin
  if p_start is null then
    p_start := coalesce(p_due, app.today());
  end if;
  -- Jump close to the answer, then step: keeps a long-running daily task cheap.
  v_k := greatest(1, case p_recurrence
    when 'daily'    then (v_after - p_start)
    when 'weekly'   then (v_after - p_start) / 7
    when 'biweekly' then (v_after - p_start) / 14
    when 'monthly'  then ((v_after - p_start) / 31)
  end);
  loop
    v_next := (p_start + v_step * v_k)::date;
    exit when v_next > v_after;
    v_k := v_k + 1;
  end loop;
  return v_next;
end
$$;

-- -----------------------------------------------------------------------------
-- complete_task: as before (any assignee or a manager; done for everyone; who
-- and when recorded), with the next-date rule above and the series carried on.
-- -----------------------------------------------------------------------------
create or replace function public.complete_task(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   public.tasks;
  v_new_id uuid;
begin
  if not (select app.is_active_user()) then
    raise exception 'Not signed in as an active account' using errcode = '42501';
  end if;
  if not ((select app.is_manager()) or app.is_assigned(p_task_id)) then
    raise exception 'Only an assignee or a manager can complete this task' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;
  if v_task.status <> 'open' then
    raise exception 'This task is already done';
  end if;

  perform set_config('app.task_change', 'on', true);

  update public.tasks
  set status = 'done', completed_by = auth.uid(), completed_at = now()
  where id = p_task_id
  returning * into v_task;

  if v_task.recurrence is not null then
    insert into public.tasks
      (title, note, priority, due_date, order_id, recurrence, created_by,
       previous_task_id, series_id, series_start)
    values
      (v_task.title, v_task.note, v_task.priority,
       app.next_task_date(v_task.series_start, v_task.recurrence, v_task.due_date),
       v_task.order_id, v_task.recurrence, v_task.created_by,
       v_task.id, v_task.series_id, v_task.series_start)
    returning id into v_new_id;

    insert into public.task_assignees (task_id, profile_id, assigned_by)
    select v_new_id, a.profile_id, a.assigned_by
    from public.task_assignees a
    where a.task_id = p_task_id;
  end if;

  return v_task;
end
$$;

-- -----------------------------------------------------------------------------
-- save_task: create (p_task_id null) or edit a task, and set exactly who it is
-- assigned to, in one step.  Managers only.
-- -----------------------------------------------------------------------------
create or replace function public.save_task(
  p_task_id    uuid,
  p_title      text,
  p_note       text,
  p_priority   public.task_priority,
  p_due_date   date,
  p_order_id   uuid,
  p_recurrence public.task_recurrence,
  p_assignees  uuid[]
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can create or change a task' using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Give the task a title';
  end if;
  if p_assignees is null or cardinality(p_assignees) = 0 then
    raise exception 'Choose at least one person to assign the task to';
  end if;
  if p_recurrence is not null and p_due_date is null then
    raise exception 'A repeating task needs a first due date';
  end if;

  if p_task_id is null then
    insert into public.tasks (title, note, priority, due_date, order_id, recurrence)
    values (trim(p_title), nullif(trim(coalesce(p_note, '')), ''), coalesce(p_priority, 'normal'),
            p_due_date, p_order_id, p_recurrence)
    returning * into v_task;
  else
    update public.tasks
    set title = trim(p_title),
        note = nullif(trim(coalesce(p_note, '')), ''),
        priority = coalesce(p_priority, 'normal'),
        due_date = p_due_date,
        order_id = p_order_id,
        recurrence = p_recurrence
    where id = p_task_id
    returning * into v_task;
    if not found then
      raise exception 'Task not found';
    end if;
  end if;

  delete from public.task_assignees
  where task_id = v_task.id and not (profile_id = any (p_assignees));

  insert into public.task_assignees (task_id, profile_id, assigned_by)
  select v_task.id, a, auth.uid()
  from (select distinct unnest(p_assignees) as a) s
  on conflict (task_id, profile_id) do nothing;

  return v_task;
end
$$;

-- -----------------------------------------------------------------------------
-- reopen_task: managers only.  Takes back the next occurrence this task's
-- completion created (if still open), then reopens it.  Refused if a later
-- occurrence of the series is open, so there is never more than one.
-- -----------------------------------------------------------------------------
create or replace function public.reopen_task(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can reopen a task' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;
  if v_task.status <> 'done' then
    raise exception 'This task is already open';
  end if;

  delete from public.tasks
  where previous_task_id = p_task_id and status = 'open';

  if exists (select 1 from public.tasks
             where series_id = v_task.series_id and status = 'open' and id <> p_task_id) then
    raise exception 'A later occurrence of this repeating task is already open, so this one cannot be reopened';
  end if;

  update public.tasks set status = 'open' where id = p_task_id
  returning * into v_task;   -- the completion trigger clears completed_by / completed_at

  return v_task;
end
$$;

revoke execute on function public.save_task(uuid, text, text, public.task_priority, date, uuid, public.task_recurrence, uuid[]) from public, anon;
grant  execute on function public.save_task(uuid, text, text, public.task_priority, date, uuid, public.task_recurrence, uuid[]) to authenticated, service_role;
revoke execute on function public.reopen_task(uuid) from public, anon;
grant  execute on function public.reopen_task(uuid) to authenticated, service_role;
