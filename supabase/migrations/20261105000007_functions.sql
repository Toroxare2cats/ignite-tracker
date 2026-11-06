-- =============================================================================
-- 0007 Functions callable from the app.
--
--   finish_order (anyone), close_order and reopen_order (managers),
--   complete_task (assignee or manager), approve_personal_item (managers),
--   order_cost / design_pricing / artist_design_hours (managers only),
--   and two manager-only metadata helpers used by the privacy test.
--
-- All are SECURITY DEFINER so they can set the transaction-local flags the
-- guard triggers look for and write tables that have no user insert policy.
-- Each one checks who is calling before doing anything.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- finish_order â€” any active artist or manager.  Records who and when.
-- -----------------------------------------------------------------------------
create or replace function public.finish_order(
  p_order_id     uuid,
  p_packing_note text    default null,
  p_box_length   numeric default null,
  p_box_width    numeric default null,
  p_box_height   numeric default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if not (select app.is_active_user()) then
    raise exception 'Not signed in as an active account' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.status <> 'open' then
    raise exception 'Only an open order can be finished (this one is %)', v_order.status;
  end if;

  perform set_config('app.status_change', 'on', true);

  update public.orders
  set status       = 'finished',
      finished_by  = auth.uid(),
      finished_at  = now(),
      packing_note = coalesce(p_packing_note, packing_note),
      box_length   = coalesce(p_box_length, box_length),
      box_width    = coalesce(p_box_width, box_width),
      box_height   = coalesce(p_box_height, box_height),
      edited_by    = auth.uid(),
      edited_at    = now()
  where id = p_order_id
  returning * into v_order;

  insert into public.order_events (order_id, event_type, actor_id, details)
  values (
    p_order_id, 'finished', auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'packing_note', p_packing_note,
      'box_length', p_box_length, 'box_width', p_box_width, 'box_height', p_box_height
    ))
  );

  return v_order;
end
$$;

-- -----------------------------------------------------------------------------
-- close_order â€” managers only.  Refuses without delivered quantities, selling
-- price and materials total.
-- -----------------------------------------------------------------------------
create or replace function public.close_order(
  p_order_id          uuid,
  p_bottles_delivered integer,
  p_dabbers_delivered integer,
  p_selling_price     numeric,
  p_materials_total   numeric,
  p_materials_note    text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can close an order' using errcode = '42501';
  end if;
  if p_bottles_delivered is null or p_dabbers_delivered is null
     or p_selling_price is null or p_materials_total is null then
    raise exception 'Delivered quantities, selling price and materials cost are required to close';
  end if;
  if p_bottles_delivered < 0 or p_dabbers_delivered < 0 or p_selling_price < 0 or p_materials_total < 0 then
    raise exception 'Delivered quantities, selling price and materials cost cannot be negative';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.status <> 'finished' then
    raise exception 'Only a finished order can be closed (this one is %)', v_order.status;
  end if;

  perform set_config('app.status_change', 'on', true);

  insert into public.order_financials as f
    (order_id, bottles_delivered, dabbers_delivered, selling_price, materials_total, materials_note,
     closed_by, closed_at, created_by)
  values
    (p_order_id, p_bottles_delivered, p_dabbers_delivered, p_selling_price, p_materials_total, p_materials_note,
     auth.uid(), now(), auth.uid())
  on conflict (order_id) do update
    set bottles_delivered = excluded.bottles_delivered,
        dabbers_delivered = excluded.dabbers_delivered,
        selling_price     = excluded.selling_price,
        materials_total   = excluded.materials_total,
        materials_note    = coalesce(excluded.materials_note, f.materials_note),
        closed_by         = auth.uid(),
        closed_at         = now(),
        edited_by         = auth.uid(),
        edited_at         = now();

  update public.orders
  set status = 'closed', edited_by = auth.uid(), edited_at = now()
  where id = p_order_id
  returning * into v_order;

  -- The event carries no money.
  insert into public.order_events (order_id, event_type, actor_id)
  values (p_order_id, 'closed', auth.uid());

  return v_order;
end
$$;

-- -----------------------------------------------------------------------------
-- reopen_order â€” managers only.  Prior completion details are kept: the
-- finished details go into the event, the financial row into history.
-- -----------------------------------------------------------------------------
create or replace function public.reopen_order(p_order_id uuid, p_reason text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_fin   public.order_financials;
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can reopen an order' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.status = 'open' then
    raise exception 'This order is already open';
  end if;

  perform set_config('app.status_change', 'on', true);

  if v_order.status = 'closed' then
    select * into v_fin from public.order_financials where order_id = p_order_id;
    if found then
      insert into public.order_financial_history (order_id, snapshot, reason, recorded_by)
      values (p_order_id, to_jsonb(v_fin), p_reason, auth.uid());
      update public.order_financials
      set closed_by = null, closed_at = null, edited_by = auth.uid(), edited_at = now()
      where order_id = p_order_id;
    end if;
  end if;

  insert into public.order_events (order_id, event_type, actor_id, reason, details)
  values (
    p_order_id, 'reopened', auth.uid(), p_reason,
    jsonb_strip_nulls(jsonb_build_object(
      'previous_status', v_order.status,
      'finished_by', v_order.finished_by,
      'finished_at', v_order.finished_at,
      'packing_note', v_order.packing_note,
      'box_length', v_order.box_length, 'box_width', v_order.box_width, 'box_height', v_order.box_height
    ))
  );

  update public.orders
  set status = 'open', finished_by = null, finished_at = null,
      edited_by = auth.uid(), edited_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end
$$;

-- -----------------------------------------------------------------------------
-- complete_task â€” any assignee or a manager.  Done for everyone; who and when
-- recorded.  A recurring task spawns its next occurrence.
-- -----------------------------------------------------------------------------
create or replace function public.complete_task(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task     public.tasks;
  v_next_due date;
  v_new_id   uuid;
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
  set status = 'done', completed_by = auth.uid(), completed_at = now(),
      edited_by = auth.uid(), edited_at = now()
  where id = p_task_id
  returning * into v_task;

  if v_task.recurrence is not null then
    v_next_due := coalesce(v_task.due_date, app.today()) + case v_task.recurrence
      when 'daily'    then interval '1 day'
      when 'weekly'   then interval '7 days'
      when 'biweekly' then interval '14 days'
      when 'monthly'  then interval '1 month'
    end;

    insert into public.tasks
      (title, note, priority, due_date, order_id, recurrence, created_by, previous_task_id)
    values
      (v_task.title, v_task.note, v_task.priority, v_next_due::date, v_task.order_id,
       v_task.recurrence, v_task.created_by, v_task.id)
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
-- approve_personal_item â€” managers only.  Turns a personal item into an
-- assigned task and marks the item "Approved -> task".
-- -----------------------------------------------------------------------------
create or replace function public.approve_personal_item(
  p_item_id   uuid,
  p_assignees uuid[],
  p_priority  public.task_priority default 'normal',
  p_due_date  date default null,
  p_order_id  uuid default null,
  p_note      text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.personal_items;
  v_task public.tasks;
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can approve a personal item' using errcode = '42501';
  end if;
  if p_assignees is null or cardinality(p_assignees) = 0 then
    raise exception 'Choose at least one person to assign the task to';
  end if;

  select * into v_item from public.personal_items where id = p_item_id for update;
  if not found then
    raise exception 'Personal item not found';
  end if;
  if v_item.status = 'approved' then
    raise exception 'This item was already approved';
  end if;

  insert into public.tasks (title, note, priority, due_date, order_id, personal_item_id, created_by)
  values (v_item.text, p_note, p_priority, p_due_date, p_order_id, v_item.id, auth.uid())
  returning * into v_task;

  insert into public.task_assignees (task_id, profile_id, assigned_by)
  select v_task.id, a, auth.uid() from unnest(p_assignees) as a;

  update public.personal_items
  set status = 'approved', task_id = v_task.id, edited_by = auth.uid(), edited_at = now()
  where id = p_item_id;

  return v_task;
end
$$;

-- -----------------------------------------------------------------------------
-- Cost functions â€” managers only.  Missing inputs are reported in `missing`
-- and the dependent figures are null, never zero.
-- -----------------------------------------------------------------------------
create or replace function public.order_cost(p_order_id uuid)
returns table (
  order_id             uuid,
  total_minutes        integer,
  labor_cost           numeric,
  materials_cost       numeric,
  recorded_cost        numeric,
  selling_price        numeric,
  amount_remaining     numeric,
  bottles_delivered    integer,
  minutes_per_bottle   numeric,
  cost_per_bottle      numeric,
  price_per_bottle     numeric,
  remaining_per_bottle numeric,
  missing              text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fin       public.order_financials;
  v_missing   text[] := '{}';
  v_minutes   integer := 0;
  v_unrated   integer := 0;
  v_labor     numeric;
  v_materials numeric;
  v_recorded  numeric;
  v_remaining numeric;
  v_extra     numeric := 0;
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can view costs' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'Order not found';
  end if;

  -- Labor: every contributor's minutes x their rate on the work date.
  select coalesce(sum(t.minutes), 0),
         count(*) filter (where app.rate_on(e.artist_id, e.work_date) is null),
         sum((t.minutes / 60.0) * app.rate_on(e.artist_id, e.work_date))
    into v_minutes, v_unrated, v_labor
  from public.entries e
  join public.entry_time t on t.entry_id = e.id
  where e.order_id = p_order_id;

  if v_unrated > 0 then
    v_labor := null;
    v_missing := v_missing || 'pay rate for a contributor';
  elsif v_minutes = 0 then
    v_labor := 0;   -- nothing logged yet is genuinely zero labor, not missing
  end if;

  -- Materials: manager total plus approved purchases and stock allocations.
  select * into v_fin from public.order_financials f where f.order_id = p_order_id;

  select coalesce(sum(p.amount), 0) into v_extra
  from public.purchases p where p.order_id = p_order_id and p.status = 'approved';
  select v_extra + coalesce(sum(s.amount), 0) into v_extra
  from public.stock_allocations s where s.order_id = p_order_id;

  if v_fin.materials_total is null then
    v_missing := v_missing || 'materials cost';
  else
    v_materials := v_fin.materials_total + v_extra;
  end if;

  if v_fin.selling_price is null then
    v_missing := v_missing || 'selling price';
  end if;
  if v_fin.bottles_delivered is null then
    v_missing := v_missing || 'delivered quantity';
  end if;

  if v_labor is not null and v_materials is not null then
    v_recorded := round(v_labor + v_materials, 2);
  end if;
  if v_recorded is not null and v_fin.selling_price is not null then
    v_remaining := round(v_fin.selling_price - v_recorded, 2);
  end if;

  return query select
    p_order_id,
    v_minutes,
    round(v_labor, 2),
    v_materials,
    v_recorded,
    v_fin.selling_price,
    v_remaining,
    v_fin.bottles_delivered,
    case when v_fin.bottles_delivered > 0 then round(v_minutes::numeric / v_fin.bottles_delivered, 2) end,
    case when v_recorded is not null and v_fin.bottles_delivered > 0 then round(v_recorded / v_fin.bottles_delivered, 2) end,
    case when v_fin.selling_price is not null and v_fin.bottles_delivered > 0 then round(v_fin.selling_price / v_fin.bottles_delivered, 2) end,
    case when v_remaining is not null and v_fin.bottles_delivered > 0 then round(v_remaining / v_fin.bottles_delivered, 2) end,
    v_missing;
end
$$;

-- Every closed run of a design, oldest first.
create or replace function public.design_pricing(p_design_id uuid)
returns table (
  order_id             uuid,
  order_name           text,
  closed_at            timestamptz,
  bottles_delivered    integer,
  total_minutes        integer,
  minutes_per_bottle   numeric,
  labor_cost           numeric,
  materials_cost       numeric,
  cost_per_bottle      numeric,
  price_per_bottle     numeric,
  remaining_per_bottle numeric,
  missing              text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can view design pricing' using errcode = '42501';
  end if;

  return query
    select o.id, o.name, f.closed_at,
           c.bottles_delivered, c.total_minutes, c.minutes_per_bottle,
           c.labor_cost, c.materials_cost, c.cost_per_bottle, c.price_per_bottle,
           c.remaining_per_bottle, c.missing
    from public.orders o
    join public.order_financials f on f.order_id = o.id
    cross join lateral public.order_cost(o.id) c
    where o.design_id = p_design_id
      and o.status = 'closed'
    order by f.closed_at;
end
$$;

-- One artist's minutes per bottle on one design, run by run, beside the
-- studio figure for the same run.
create or replace function public.artist_design_hours(p_artist_id uuid, p_design_id uuid)
returns table (
  order_id                  uuid,
  order_name                text,
  closed_at                 timestamptz,
  bottles_delivered         integer,
  artist_minutes            integer,
  artist_minutes_per_bottle numeric,
  studio_minutes            integer,
  studio_minutes_per_bottle numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can compare artists' using errcode = '42501';
  end if;

  return query
    select o.id, o.name, f.closed_at, f.bottles_delivered,
           coalesce(a.minutes, 0)::integer,
           case when f.bottles_delivered > 0 and a.minutes is not null
                then round(a.minutes / f.bottles_delivered::numeric, 2) end,
           coalesce(s.minutes, 0)::integer,
           case when f.bottles_delivered > 0 and s.minutes is not null
                then round(s.minutes / f.bottles_delivered::numeric, 2) end
    from public.orders o
    join public.order_financials f on f.order_id = o.id
    left join lateral (
      select sum(t.minutes) as minutes
      from public.entries e join public.entry_time t on t.entry_id = e.id
      where e.order_id = o.id and e.artist_id = p_artist_id
    ) a on true
    left join lateral (
      select sum(t.minutes) as minutes
      from public.entries e join public.entry_time t on t.entry_id = e.id
      where e.order_id = o.id
    ) s on true
    where o.design_id = p_design_id
      and o.status = 'closed'
    order by f.closed_at;
end
$$;

-- -----------------------------------------------------------------------------
-- Manager-only metadata helpers for the privacy test: which tables have
-- row-level security switched on, and which columns exist.
-- -----------------------------------------------------------------------------
create or replace function public.rls_status()
returns table (table_name text, rls_enabled boolean, policy_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.relname::text,
         c.relrowsecurity,
         (select count(*)::integer from pg_catalog.pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (select app.is_manager())
  order by c.relname
$$;

create or replace function public.table_columns()
returns table (table_name text, column_name text, data_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.table_name::text, c.column_name::text, c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'public'
    and (select app.is_manager())
  order by c.table_name, c.ordinal_position
$$;
