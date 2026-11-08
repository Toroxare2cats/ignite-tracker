-- =============================================================================
-- 0015 Manager portal, approvals.
--
--   1. A decision on a purchase is final.  Once approved or rejected, a purchase
--      cannot be decided again or changed, so a second manager with an old page
--      open cannot overturn the first, and an approved amount cannot move after
--      stock has been allocated from it.
--   2. A closed order's costs hold still.  An order's materials cost is worked
--      out live from approved purchases and stock allocations, so approving a
--      purchase or changing an allocation on a closed order would silently
--      change finished figures.  The order must be reopened first, as it must
--      for entries and hours.  Rejecting stays allowed: it changes no cost.
--   3. Two managers allocating from one stock purchase at the same moment cannot
--      go over its amount, because the purchase is locked while the total is
--      checked.
-- =============================================================================

create or replace function app.protect_purchase_decision()
returns trigger
language plpgsql
as $$
begin
  if app.is_app_user() and not (select app.is_manager()) then
    if new.status is distinct from old.status
    or new.decided_by is distinct from old.decided_by
    or new.decided_at is distinct from old.decided_at
    or new.decision_reason is distinct from old.decision_reason then
      raise exception 'Only a manager can approve or reject a purchase' using errcode = '42501';
    end if;
  end if;

  if app.is_app_user() and old.status <> 'pending' then
    raise exception 'This purchase has already been decided and cannot change.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
    if new.status = 'rejected' and coalesce(btrim(new.decision_reason), '') = '' then
      raise exception 'A rejection needs a one-line reason';
    end if;
    if new.status = 'approved' and app.is_app_user() and exists (
      select 1 from public.orders o where o.id = new.order_id and o.status = 'closed'
    ) then
      raise exception 'This order is closed. Reopen it before approving this purchase.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create or replace function app.check_stock_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
  already numeric;
begin
  select * into p from public.purchases where id = new.purchase_id for update;
  if not found or not p.for_stock or p.status <> 'approved' then
    raise exception 'Allocations come only from approved stock purchases';
  end if;
  select coalesce(sum(amount), 0) into already
  from public.stock_allocations
  where purchase_id = new.purchase_id and id <> new.id;
  if already + new.amount > p.amount then
    raise exception 'That is more than is left on this stock purchase.';
  end if;
  return new;
end
$$;

create or replace function app.block_allocation_on_closed_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_order uuid := case when tg_op <> 'INSERT' then old.order_id end;
  v_new_order uuid := case when tg_op <> 'DELETE' then new.order_id end;
begin
  if app.is_app_user() and exists (
    select 1 from public.orders o
    where o.status = 'closed' and o.id in (v_old_order, v_new_order)
  ) then
    raise exception 'This order is closed. Reopen it before changing the stock allocated to it.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger stock_allocations_block_closed
  before insert or update or delete on public.stock_allocations
  for each row execute function app.block_allocation_on_closed_order();
