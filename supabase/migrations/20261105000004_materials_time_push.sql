-- =============================================================================
-- 0004 Materials, timesheets and reminders: purchases, stock_allocations,
--      uattend_imports, uattend_days, push_subscriptions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- purchases â€” an artist's materials purchase submission.  Artists see only
-- their own; managers approve or reject.
-- -----------------------------------------------------------------------------
create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  artist_id       uuid not null references public.profiles (id) default auth.uid(),
  order_id        uuid references public.orders (id),
  for_stock       boolean not null default false,
  description     text not null,
  amount          numeric(10, 2) not null check (amount >= 0),
  receipt_path    text,                                   -- object path in the receipts bucket
  status          public.purchase_status not null default 'pending',
  decided_by      uuid references public.profiles (id),
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz not null default now(),
  edited_by       uuid references public.profiles (id),
  edited_at       timestamptz,
  -- Exactly one of: for an order, or for studio stock.
  constraint purchases_target check (
    (order_id is not null and not for_stock) or (order_id is null and for_stock)
  )
);

create index purchases_artist on public.purchases (artist_id, created_at desc);
create index purchases_order on public.purchases (order_id);
create index purchases_status on public.purchases (status);

alter table public.purchases enable row level security;

create policy "purchases: own or manager read"
  on public.purchases for select to authenticated
  using ((select app.is_manager()) or artist_id = auth.uid());

create policy "purchases: own insert (pending) or manager"
  on public.purchases for insert to authenticated
  with check (
    (select app.is_manager())
    or ((select app.is_active_user()) and artist_id = auth.uid() and status = 'pending')
  );

create policy "purchases: own while pending or manager update"
  on public.purchases for update to authenticated
  using ((select app.is_manager()) or (artist_id = auth.uid() and status = 'pending'))
  with check ((select app.is_manager()) or artist_id = auth.uid());

create policy "purchases: own while pending or manager delete"
  on public.purchases for delete to authenticated
  using ((select app.is_manager()) or (artist_id = auth.uid() and status = 'pending'));

create trigger purchases_set_edited
  before update on public.purchases
  for each row execute function app.set_edited();

-- Only a manager decides.  Approved / rejected rows record who and when.
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
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
    if new.status = 'rejected' and coalesce(new.decision_reason, '') = '' then
      raise exception 'A rejection needs a one-line reason';
    end if;
  end if;
  return new;
end
$$;

create trigger purchases_protect_decision
  before update on public.purchases
  for each row execute function app.protect_purchase_decision();

-- -----------------------------------------------------------------------------
-- stock_allocations â€” manager-only.  Portions of an approved stock purchase
-- assigned to orders.
-- -----------------------------------------------------------------------------
create table public.stock_allocations (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  order_id    uuid not null references public.orders (id),
  amount      numeric(10, 2) not null check (amount > 0),
  note        text,
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create index stock_allocations_order on public.stock_allocations (order_id);
create index stock_allocations_purchase on public.stock_allocations (purchase_id);

alter table public.stock_allocations enable row level security;

create policy "stock_allocations: managers read"
  on public.stock_allocations for select to authenticated
  using ((select app.is_manager()));

create policy "stock_allocations: managers insert"
  on public.stock_allocations for insert to authenticated
  with check ((select app.is_manager()));

create policy "stock_allocations: managers update"
  on public.stock_allocations for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy "stock_allocations: managers delete"
  on public.stock_allocations for delete to authenticated
  using ((select app.is_manager()));

-- An allocation must come from an approved stock purchase and the total
-- allocated may not exceed the purchase amount.
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
  select * into p from public.purchases where id = new.purchase_id;
  if not found or not p.for_stock or p.status <> 'approved' then
    raise exception 'Allocations come only from approved stock purchases';
  end if;
  select coalesce(sum(amount), 0) into already
  from public.stock_allocations
  where purchase_id = new.purchase_id and id <> new.id;
  if already + new.amount > p.amount then
    raise exception 'Allocated total (%) would exceed the purchase amount (%)', already + new.amount, p.amount;
  end if;
  return new;
end
$$;

create trigger stock_allocations_check
  before insert or update on public.stock_allocations
  for each row execute function app.check_stock_allocation();

-- -----------------------------------------------------------------------------
-- uattend_imports / uattend_days â€” manager-only.  Weekly uAttend CSV uploads
-- and the clocked minutes per artist per day they produce.
-- -----------------------------------------------------------------------------
create table public.uattend_imports (
  id          uuid primary key default gen_random_uuid(),
  file_name   text,
  period_from date,
  period_to   date,
  row_count   integer,
  notes       text,
  uploaded_by uuid references public.profiles (id) default auth.uid(),
  uploaded_at timestamptz not null default now()
);

alter table public.uattend_imports enable row level security;

create policy "uattend_imports: managers read"
  on public.uattend_imports for select to authenticated
  using ((select app.is_manager()));

create policy "uattend_imports: managers insert"
  on public.uattend_imports for insert to authenticated
  with check ((select app.is_manager()));

create policy "uattend_imports: managers delete"
  on public.uattend_imports for delete to authenticated
  using ((select app.is_manager()));

create table public.uattend_days (
  id              uuid primary key default gen_random_uuid(),
  artist_id       uuid not null references public.profiles (id),
  work_date       date not null,
  clocked_minutes integer not null check (clocked_minutes >= 0),
  import_id       uuid references public.uattend_imports (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (artist_id, work_date)
);

alter table public.uattend_days enable row level security;

create policy "uattend_days: managers read"
  on public.uattend_days for select to authenticated
  using ((select app.is_manager()));

create policy "uattend_days: managers insert"
  on public.uattend_days for insert to authenticated
  with check ((select app.is_manager()));

create policy "uattend_days: managers update"
  on public.uattend_days for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy "uattend_days: managers delete"
  on public.uattend_days for delete to authenticated
  using ((select app.is_manager()));

-- -----------------------------------------------------------------------------
-- push_subscriptions â€” each phone's reminder address.  Own rows; managers
-- can see all (to know who has reminders set up).
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: own or manager read"
  on public.push_subscriptions for select to authenticated
  using ((select app.is_manager()) or profile_id = auth.uid());

create policy "push_subscriptions: own insert"
  on public.push_subscriptions for insert to authenticated
  with check ((select app.is_active_user()) and profile_id = auth.uid());

create policy "push_subscriptions: own update"
  on public.push_subscriptions for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "push_subscriptions: own or manager delete"
  on public.push_subscriptions for delete to authenticated
  using ((select app.is_manager()) or profile_id = auth.uid());
