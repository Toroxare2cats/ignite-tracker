-- =============================================================================
-- 0018 Tasks tab: what an approved personal item became.
--
-- When a manager approves a personal item, the task it becomes may be assigned
-- to other people.  The item's owner cannot read that task (row-level
-- security shows artists only tasks assigned to them), but the brief says the
-- item shows "Approved -> task" with who it went to.  This function returns
-- exactly that, and nothing else, for the caller's own items (managers: all).
--
-- Also: once approved, an item's words belong to the task, so its owner can
-- no longer change its text or status (deleting it is still allowed; the task
-- stays).  No money anywhere (rules 1 and 12).
-- =============================================================================

create or replace function public.personal_item_outcomes()
returns table (
  item_id        uuid,
  task_id        uuid,
  task_title     text,
  task_status    public.task_status,
  assignee_names text[],
  approved_by    text,
  approved_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         t.id,
         t.title,
         t.status,
         array(
           select p.full_name
           from public.task_assignees a
           join public.profiles p on p.id = a.profile_id
           where a.task_id = t.id
           order by p.full_name
         ),
         m.full_name,
         t.created_at
  from public.personal_items i
  join public.tasks t on t.id = i.task_id
  left join public.profiles m on m.id = t.created_by
  where i.status = 'approved'
    and (select app.is_active_user())
    and (i.owner_id = auth.uid() or (select app.is_manager()))
$$;

revoke execute on function public.personal_item_outcomes() from public, anon;
grant  execute on function public.personal_item_outcomes() to authenticated, service_role;

-- An approved item is fixed for its owner: the task already took its words.
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
    if old.status = 'approved'
    and (new.text is distinct from old.text or new.status is distinct from old.status) then
      raise exception 'This item was approved into a task and can no longer be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
