-- =============================================================================
-- 0003 Orders and daily work: orders, order_financials,
--      order_financial_history, order_events, entries, entry_time, studio_time.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- orders â€” one production run of a design.  Readable by everyone.  Managers
-- create and edit.  Status changes are allowed only through finish_order /
-- close_order / reopen_order (migration 0007), enforced by a trigger.
-- -----------------------------------------------------------------------------
create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  design_id            uuid not null references public.designs (id),
  bottles_ordered      integer not null default 0 check (bottles_ordered >= 0),
  dabbers_ordered      integer not null default 0 check (dabbers_ordered >= 0),
  due_date             date,
  primary_artist_id    uuid references public.profiles (id),
  status               public.order_status not null default 'open',
  -- Specifications copied from the design at creation; managers may edit this
  -- copy for the run without touching the design.
  spec_dimensions      text,
  spec_colors_finishes text,
  spec_instructions    text,
  -- Finished details (no money here)
  finished_by          uuid references public.profiles (id),
  finished_at          timestamptz,
  packing_note         text,
  box_length           numeric(8, 2) check (box_length is null or box_length > 0),
  box_width            numeric(8, 2) check (box_width is null or box_width > 0),
  box_height           numeric(8, 2) check (box_height is null or box_height > 0),
  created_by           uuid references public.profiles (id) default auth.uid(),
  created_at           timestamptz not null default now(),
  edited_by            uuid references public.profiles (id),
  edited_at            timestamptz
);

create index orders_status_due on public.orders (status, due_date);
create index orders_primary_artist on public.orders (primary_artist_id);
create index orders_design on public.orders (design_id);

alter table public.orders enable row level security;

create policy "orders: everyone reads"
  on public.orders for select to authenticated
  using ((select app.is_active_user()));

create policy "orders: managers insert"
  on public.orders for insert to authenticated
  with check ((select app.is_manager()));

create policy "orders: managers update"
  on public.orders for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy "orders: managers delete"
  on public.orders for delete to authenticated
  using ((select app.is_manager()));

create trigger orders_set_edited
  before update on public.orders
  for each row execute function app.set_edited();

-- Copy the design's text specifications onto the order when it is created.
create or replace function app.copy_design_specs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.designs;
begin
  select * into d from public.designs where id = new.design_id;
  if not found then
    raise exception 'Design not found';
  end if;
  new.spec_dimensions      := coalesce(new.spec_dimensions, d.dimensions);
  new.spec_colors_finishes := coalesce(new.spec_colors_finishes, d.colors_finishes);
  new.spec_instructions    := coalesce(new.spec_instructions, d.instructions);
  return new;
end
$$;

create trigger orders_copy_design_specs
  before insert on public.orders
  for each row execute function app.copy_design_specs();

-- Status and completion fields may only change inside the completion
-- functions, which set the transaction-local flag app.status_change = 'on'.
create or replace function app.guard_order_status()
returns trigger
language plpgsql
as $$
declare
  allowed boolean := coalesce(current_setting('app.status_change', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not allowed and (new.status <> 'open' or new.finished_by is not null or new.finished_at is not null) then
      raise exception 'A new order always starts open; use finish_order / close_order to change status'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if not allowed and (
       new.status      is distinct from old.status
    or new.finished_by is distinct from old.finished_by
    or new.finished_at is distinct from old.finished_at
  ) then
    raise exception 'Order status changes only through finish_order, close_order or reopen_order'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger orders_guard_status
  before insert or update on public.orders
  for each row execute function app.guard_order_status();

-- -----------------------------------------------------------------------------
-- order_financials â€” manager-only.  One row per order, created when a manager
-- first enters a figure or when the order is closed.
-- -----------------------------------------------------------------------------
create table public.order_financials (
  order_id          uuid primary key references public.orders (id) on delete cascade,
  bottles_delivered integer check (bottles_delivered is null or bottles_delivered >= 0),
  dabbers_delivered integer check (dabbers_delivered is null or dabbers_delivered >= 0),
  selling_price     numeric(10, 2) check (selling_price is null or selling_price >= 0),  -- order total
  materials_total   numeric(10, 2) check (materials_total is null or materials_total >= 0), -- manager-entered total
  materials_note    text,
  closed_by         uuid references public.profiles (id),
  closed_at         timestamptz,
  created_by        uuid references public.profiles (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  edited_by         uuid references public.profiles (id),
  edited_at         timestamptz
);

alter table public.order_financials enable row level security;

create policy "order_financials: managers read"
  on public.order_financials for select to authenticated
  using ((select app.is_manager()));

create policy "order_financials: managers insert"
  on public.order_financials for insert to authenticated
  with check ((select app.is_manager()));

create policy "order_financials: managers update"
  on public.order_financials for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create trigger order_financials_set_edited
  before update on public.order_financials
  for each row execute function app.set_edited();

-- closed_by / closed_at change only inside close_order / reopen_order.
create or replace function app.guard_financial_close()
returns trigger
language plpgsql
as $$
declare
  allowed boolean := coalesce(current_setting('app.status_change', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not allowed and (new.closed_by is not null or new.closed_at is not null) then
      raise exception 'Closing an order goes through close_order' using errcode = '42501';
    end if;
    return new;
  end if;
  if not allowed and (new.closed_by is distinct from old.closed_by or new.closed_at is distinct from old.closed_at) then
    raise exception 'Closing or reopening an order goes through close_order / reopen_order' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger order_financials_guard_close
  before insert or update on public.order_financials
  for each row execute function app.guard_financial_close();

-- -----------------------------------------------------------------------------
-- order_financial_history â€” manager-only.  When a closed order is reopened the
-- previous financial row is copied here, so prior completion details are kept.
-- -----------------------------------------------------------------------------
create table public.order_financial_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  snapshot    jsonb not null,
  reason      text,
  recorded_by uuid references public.profiles (id),
  recorded_at timestamptz not null default now()
);

alter table public.order_financial_history enable row level security;

create policy "order_financial_history: managers read"
  on public.order_financial_history for select to authenticated
  using ((select app.is_manager()));

-- Written only by reopen_order (SECURITY DEFINER); no insert policy needed.

-- -----------------------------------------------------------------------------
-- order_events â€” created / finished / closed / reopened, who and when.
-- Readable by everyone; written only by triggers and completion functions.
-- `details` never carries money.
-- -----------------------------------------------------------------------------
create table public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  event_type  public.order_event_type not null,
  actor_id    uuid references public.profiles (id),
  occurred_at timestamptz not null default now(),
  reason      text,
  details     jsonb not null default '{}'::jsonb
);

create index order_events_order on public.order_events (order_id, occurred_at);

alter table public.order_events enable row level security;

create policy "order_events: everyone reads"
  on public.order_events for select to authenticated
  using ((select app.is_active_user()));

-- Record the creation event automatically.
create or replace function app.record_order_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_events (order_id, event_type, actor_id)
  values (new.id, 'created', coalesce(auth.uid(), new.created_by));
  return new;
end
$$;

create trigger orders_record_created
  after insert on public.orders
  for each row execute function app.record_order_created();

-- -----------------------------------------------------------------------------
-- entries â€” one per artist, per order, per day.  Counts and note are shared;
-- hours live in entry_time.
-- -----------------------------------------------------------------------------
create table public.entries (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id),
  artist_id        uuid not null references public.profiles (id) default auth.uid(),
  work_date        date not null default app.today(),
  bottles          integer check (bottles is null or bottles >= 0),
  dabbers          integer check (dabbers is null or dabbers >= 0),
  points           integer check (points is null or points >= 0),
  color_tube_preps integer check (color_tube_preps is null or color_tube_preps >= 0),
  blanks           integer check (blanks is null or blanks >= 0),
  fuming           integer check (fuming is null or fuming >= 0),
  note             text,
  created_at       timestamptz not null default now(),
  edited_by        uuid references public.profiles (id),
  edited_at        timestamptz,
  unique (order_id, artist_id, work_date)   -- a repeated tap cannot duplicate
);

create index entries_artist_date on public.entries (artist_id, work_date);
create index entries_order on public.entries (order_id, work_date);

alter table public.entries enable row level security;

create policy "entries: everyone reads"
  on public.entries for select to authenticated
  using ((select app.is_active_user()));

create policy "entries: own within 7 days or manager insert"
  on public.entries for insert to authenticated
  with check (
    (select app.is_manager())
    or ((select app.is_active_user()) and artist_id = auth.uid() and app.within_edit_window(work_date))
  );

create policy "entries: own within 7 days or manager update"
  on public.entries for update to authenticated
  using (
    (select app.is_manager())
    or (artist_id = auth.uid() and app.within_edit_window(work_date))
  )
  with check (
    (select app.is_manager())
    or (artist_id = auth.uid() and app.within_edit_window(work_date))
  );

create policy "entries: own within 7 days or manager delete"
  on public.entries for delete to authenticated
  using (
    (select app.is_manager())
    or (artist_id = auth.uid() and app.within_edit_window(work_date))
  );

create trigger entries_set_edited
  before update on public.entries
  for each row execute function app.set_edited();

-- Nobody writes entries on a closed order; a manager reopens it first.
create or replace function app.block_entries_on_closed_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  v_status public.order_status;
begin
  select status into v_status from public.orders where id = v_order_id;
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

create trigger entries_block_closed
  before insert or update or delete on public.entries
  for each row execute function app.block_entries_on_closed_order();

-- Does the signed-in user own this entry and is it still inside their window?
create or replace function app.entry_editable_by_me(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.entries e
    where e.id = p_entry_id
      and e.artist_id = auth.uid()
      and app.within_edit_window(e.work_date)
  )
$$;

create or replace function app.entry_owned_by_me(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.entries e
    where e.id = p_entry_id
      and e.artist_id = auth.uid()
  )
$$;

-- -----------------------------------------------------------------------------
-- entry_time â€” minutes for one entry.  Visible to the entry's author and to
-- managers only.
-- -----------------------------------------------------------------------------
create table public.entry_time (
  entry_id  uuid primary key references public.entries (id) on delete cascade,
  minutes   integer not null check (minutes > 0 and minutes <= 1440),
  edited_by uuid references public.profiles (id),
  edited_at timestamptz
);

alter table public.entry_time enable row level security;

create policy "entry_time: own or manager read"
  on public.entry_time for select to authenticated
  using ((select app.is_manager()) or app.entry_owned_by_me(entry_id));

create policy "entry_time: own within 7 days or manager insert"
  on public.entry_time for insert to authenticated
  with check ((select app.is_manager()) or app.entry_editable_by_me(entry_id));

create policy "entry_time: own within 7 days or manager update"
  on public.entry_time for update to authenticated
  using ((select app.is_manager()) or app.entry_editable_by_me(entry_id))
  with check ((select app.is_manager()) or app.entry_editable_by_me(entry_id));

create policy "entry_time: own within 7 days or manager delete"
  on public.entry_time for delete to authenticated
  using ((select app.is_manager()) or app.entry_editable_by_me(entry_id));

create trigger entry_time_set_edited
  before update on public.entry_time
  for each row execute function app.set_edited();

-- -----------------------------------------------------------------------------
-- studio_time â€” optional explanation of time not spent on orders.  Own rows
-- only for artists; managers see all.
-- -----------------------------------------------------------------------------
create table public.studio_time (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.profiles (id) default auth.uid(),
  work_date  date not null default app.today(),
  category   public.studio_time_category not null,
  minutes    integer not null check (minutes > 0 and minutes <= 1440),
  note       text,
  created_at timestamptz not null default now(),
  edited_by  uuid references public.profiles (id),
  edited_at  timestamptz
);

create index studio_time_artist_date on public.studio_time (artist_id, work_date);

alter table public.studio_time enable row level security;

create policy "studio_time: own or manager read"
  on public.studio_time for select to authenticated
  using ((select app.is_manager()) or artist_id = auth.uid());

create policy "studio_time: own within 7 days or manager insert"
  on public.studio_time for insert to authenticated
  with check (
    (select app.is_manager())
    or ((select app.is_active_user()) and artist_id = auth.uid() and app.within_edit_window(work_date))
  );

create policy "studio_time: own within 7 days or manager update"
  on public.studio_time for update to authenticated
  using ((select app.is_manager()) or (artist_id = auth.uid() and app.within_edit_window(work_date)))
  with check ((select app.is_manager()) or (artist_id = auth.uid() and app.within_edit_window(work_date)));

create policy "studio_time: own within 7 days or manager delete"
  on public.studio_time for delete to authenticated
  using ((select app.is_manager()) or (artist_id = auth.uid() and app.within_edit_window(work_date)));

create trigger studio_time_set_edited
  before update on public.studio_time
  for each row execute function app.set_edited();
