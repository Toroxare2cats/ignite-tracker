-- =============================================================================
-- 0017 Order cost by contributor (session 4, Order cost report).
--
--   One row per person who logged hours on the order: their minutes and their
--   share of the labor cost, using the rate in force on each entry's work date
--   (rule 5), so the figures agree with order_cost to the cent.  A contributor
--   with no rate on one of their work dates has a null labor cost and
--   rated = false; the report shows it as missing, never zero (rule 6).
--   Managers only, like every cost function.
-- =============================================================================

create or replace function public.order_cost_by_contributor(p_order_id uuid)
returns table (
  artist_id   uuid,
  entry_count integer,
  minutes     integer,
  labor_cost  numeric,
  rated       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app.is_manager()) then
    raise exception 'Only a manager can view costs' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'Order not found';
  end if;

  return query
    select e.artist_id,
           count(*)::integer,
           coalesce(sum(t.minutes), 0)::integer,
           case when bool_and(app.rate_on(e.artist_id, e.work_date) is not null)
                then round(sum((t.minutes / 60.0) * app.rate_on(e.artist_id, e.work_date)), 2)
           end,
           bool_and(app.rate_on(e.artist_id, e.work_date) is not null)
    from public.entries e
    join public.entry_time t on t.entry_id = e.id
    where e.order_id = p_order_id
    group by e.artist_id
    order by sum(t.minutes) desc;
end
$$;
