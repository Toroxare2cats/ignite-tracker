-- =============================================================================
-- 0011 Fix order_cost: appending to the `missing` list.
--
-- `v_missing || 'materials cost'` made Postgres treat the label as an array
-- literal ("malformed array literal").  array_append is unambiguous.
-- Found by the privacy test on the first run with real logins.  Everything
-- else in the function is unchanged.
-- =============================================================================

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
    v_missing := array_append(v_missing, 'pay rate for a contributor');
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
    v_missing := array_append(v_missing, 'materials cost');
  else
    v_materials := v_fin.materials_total + v_extra;
  end if;

  if v_fin.selling_price is null then
    v_missing := array_append(v_missing, 'selling price');
  end if;
  if v_fin.bottles_delivered is null then
    v_missing := array_append(v_missing, 'delivered quantity');
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
