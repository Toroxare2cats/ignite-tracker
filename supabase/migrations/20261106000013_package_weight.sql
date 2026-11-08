-- Package weight, recorded with the box dimensions when an order is marked
-- Finished (Arvin's request, session 3: an addition to the brief's "packing
-- note and box dimensions").  Optional, in pounds, and not financial, so it
-- belongs on orders with the other box details.

alter table public.orders
  add column box_weight numeric(8, 2) check (box_weight is null or box_weight > 0);

comment on column public.orders.box_weight is 'Package weight in pounds, for the shipping label';

-- -----------------------------------------------------------------------------
-- finish_order gains p_box_weight.  A new parameter would otherwise leave two
-- versions of the function side by side, so the old one is dropped first.
-- -----------------------------------------------------------------------------
drop function public.finish_order(uuid, text, numeric, numeric, numeric);

create function public.finish_order(
  p_order_id     uuid,
  p_packing_note text    default null,
  p_box_length   numeric default null,
  p_box_width    numeric default null,
  p_box_height   numeric default null,
  p_box_weight   numeric default null
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
      box_weight   = coalesce(p_box_weight, box_weight),
      edited_by    = auth.uid(),
      edited_at    = now()
  where id = p_order_id
  returning * into v_order;

  insert into public.order_events (order_id, event_type, actor_id, details)
  values (
    p_order_id, 'finished', auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'packing_note', p_packing_note,
      'box_length', p_box_length, 'box_width', p_box_width, 'box_height', p_box_height,
      'box_weight', p_box_weight
    ))
  );

  return v_order;
end
$$;

-- A recreated function starts with Postgres's own default, which lets everyone
-- run it.  The defaults set in 20261105000009_grants.sql are per schema and
-- cannot take that away, so its permissions are stated here.
revoke execute on function public.finish_order(uuid, text, numeric, numeric, numeric, numeric) from public, anon;
grant  execute on function public.finish_order(uuid, text, numeric, numeric, numeric, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- reopen_order keeps the weight with the other prior completion details.
-- Unchanged otherwise.
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
      'box_length', v_order.box_length, 'box_width', v_order.box_width, 'box_height', v_order.box_height,
      'box_weight', v_order.box_weight
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
