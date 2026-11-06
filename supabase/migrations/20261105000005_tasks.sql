-- =============================================================================
-- 0005 Task lists: tasks, task_assignees, personal_items.
--
-- No money column may ever be added to these tables (rule 1 and rule 12).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- personal_items â€” each person's own list.  Visible to the owner and to
-- managers, never to other artists.  (Created first because tasks point at
-- the item they came from.)
-- -----------------------------------------------------------------------------
create table public.personal_items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) default auth.uid(),
  text       text not null check (length(trim(text)) > 0),
  status     public.personal_item_status not null default 'open',
  task_id    uuid,                                   -- the assigned task it became (FK added below)
  created_at timestamptz not null default now(),
  edited_by  uuid references public.profiles (id),
  edited_at  timestamptz
);

create index personal_items_owner on public.personal_items (owner_id, created_at desc);

alter table public.personal_items enable row level security;

create policy "personal_items: own or manager read"
  on public.personal_items for select to authenticated
  using ((select app.is_manager()) or owner_id = auth.uid());

create policy "personal_items: own insert"
  on public.personal_items for insert to authenticated
  with check ((select app.is_active_user()) and owner_id = auth.uid() and status = 'open' and task_id is null);

create policy "personal_items: own or manager update"
  on public.personal_items for update to authenticated
  using ((select app.is_manager()) or owner_id = auth.uid())
  with check ((select app.is_manager()) or owner_id = auth.uid());

create policy "personal_items: own or manager delete"
  on public.personal_items for delete to authenticated
  using ((select app.is_manager()) or owner_id = auth.uid());

create trigger personal_items_set_edited
  before update on public.personal_items
  for each row execute function app.set_edited();

-- Only a manager can approve an item (turn it into a task).
create or replace function app.protect_personal_item_approval()
returns trigger
language plpgsql
as $$
begin
  if app.is_app_user() and not (select app.is_manager()) then
    if (new.status = 'approved' and old.status <> 'approved')
    or new.task_id is distinct from old.task_id
    or new.owner_id is distinct from old.owner_id then
      raise exception 'Only a manager can approve a personal item' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger personal_items_protect_approval
  before update on public.personal_items
  for each row execute function app.protect_personal_item_approval();

-- -----------------------------------------------------------------------------
-- tasks â€” manager-assigned.  Artists read only tasks assigned to them.
-- Only managers create, assign, edit or reopen; completion goes through
-- complete_task (migration 0007).
-- -----------------------------------------------------------------------------
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(trim(title)) > 0),
  note             text,
  priority         public.task_priority not null default 'normal',
  due_date         date,
  order_id         uuid references public.orders (id) on delete set null,
  recurrence       public.task_recurrence,           -- null = one-off, or recurrence stopped
  status           public.task_status not null default 'open',
  completed_by     uuid references public.profiles (id),
  completed_at     timestamptz,
  personal_item_id uuid references public.personal_items (id) on delete set null,
  previous_task_id uuid references public.tasks (id) on delete set null,  -- the occurrence this one followed
  created_by       uuid references public.profiles (id) default auth.uid(),
  created_at       timestamptz not null default now(),
  edited_by        uuid references public.profiles (id),
  edited_at        timestamptz
);

alter table public.personal_items
  add constraint personal_items_task_fk
  foreign key (task_id) references public.tasks (id) on delete set null;

create index tasks_status_due on public.tasks (status, due_date);
create index tasks_order on public.tasks (order_id);

alter table public.tasks enable row level security;

-- -----------------------------------------------------------------------------
-- task_assignees â€” who a task is assigned to.  Assignees see each other.
-- (Created before the task policies, which need to look rows up here.)
-- -----------------------------------------------------------------------------
create table public.task_assignees (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id),
  assigned_by uuid references public.profiles (id) default auth.uid(),
  assigned_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

create index task_assignees_profile on public.task_assignees (profile_id);

alter table public.task_assignees enable row level security;

-- Is the signed-in user assigned to this task?  SECURITY DEFINER so the
-- task_assignees policy can call it without recursing into itself.
create or replace function app.is_assigned(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_assignees a
    where a.task_id = p_task_id
      and a.profile_id = auth.uid()
  )
$$;

create policy "tasks: assigned or manager read"
  on public.tasks for select to authenticated
  using ((select app.is_manager()) or app.is_assigned(id));

create policy "tasks: managers insert"
  on public.tasks for insert to authenticated
  with check ((select app.is_manager()));

create policy "tasks: managers update"
  on public.tasks for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy "tasks: managers delete"
  on public.tasks for delete to authenticated
  using ((select app.is_manager()));

create trigger tasks_set_edited
  before update on public.tasks
  for each row execute function app.set_edited();

-- Completion fields change only inside complete_task (or a manager reopening,
-- which clears them).
create or replace function app.guard_task_completion()
returns trigger
language plpgsql
as $$
declare
  allowed boolean := coalesce(current_setting('app.task_change', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not allowed and (new.status <> 'open' or new.completed_by is not null or new.completed_at is not null) then
      raise exception 'A new task always starts open' using errcode = '42501';
    end if;
    return new;
  end if;
  -- A manager may reopen (done -> open) directly; marking done goes through complete_task.
  if not allowed and new.status = 'done' and old.status <> 'done' then
    raise exception 'Completing a task goes through complete_task' using errcode = '42501';
  end if;
  if new.status = 'open' and old.status = 'done' then
    new.completed_by := null;
    new.completed_at := null;
  end if;
  return new;
end
$$;

create trigger tasks_guard_completion
  before insert or update on public.tasks
  for each row execute function app.guard_task_completion();

-- task_assignees policies ------------------------------------------------------
create policy "task_assignees: co-assignees or manager read"
  on public.task_assignees for select to authenticated
  using ((select app.is_manager()) or app.is_assigned(task_id));

create policy "task_assignees: managers insert"
  on public.task_assignees for insert to authenticated
  with check ((select app.is_manager()));

create policy "task_assignees: managers delete"
  on public.task_assignees for delete to authenticated
  using ((select app.is_manager()));
