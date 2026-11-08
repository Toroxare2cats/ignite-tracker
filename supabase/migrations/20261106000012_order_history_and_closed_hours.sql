-- =============================================================================
-- 0012 Manager portal, orders.
--
--   1. Reassigning the primary artist is recorded in the order's history, with
--      who and when.  The history is readable by everyone, so it stores only
--      the two people's ids, never money.
--   2. Hours on a closed order are locked.  Entries were already locked by
--      app.block_entries_on_closed_order, but hours live in their own table
--      (entry_time) and that table was not covered, so an artist calling the
--      database directly could have changed the minutes behind a closed
--      order's labor cost.  The screens never allowed it; now the database
--      refuses it too.
-- =============================================================================

alter type public.order_event_type add value if not exists 'reassigned';

create or replace function app.record_order_reassigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_events (order_id, event_type, actor_id, details)
  values (
    new.id, 'reassigned', auth.uid(),
    jsonb_strip_nulls(jsonb_build_object('from', old.primary_artist_id, 'to', new.primary_artist_id))
  );
  return new;
end
$$;

create trigger orders_record_reassigned
  after update of primary_artist_id on public.orders
  for each row
  when (old.primary_artist_id is distinct from new.primary_artist_id)
  execute function app.record_order_reassigned();

create or replace function app.block_hours_on_closed_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
  v_status   public.order_status;
begin
  select o.status into v_status
  from public.entries e
  join public.orders o on o.id = e.order_id
  where e.id = v_entry_id;

  if v_status = 'closed' then
    raise exception 'This order is closed; a manager must reopen it before entries change'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger entry_time_block_closed
  before insert or update or delete on public.entry_time
  for each row execute function app.block_hours_on_closed_order();
