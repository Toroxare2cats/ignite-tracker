-- =============================================================================
-- 0002 People and designs: profiles, pay_rates, designs, design_prices,
--      design_photos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles â€” one row per account.  Artists read everyone's name and role
-- through the `people` view below; the full row (login email, alternate
-- emails, preferences) is readable only by its owner and by managers.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text not null,
  email            text not null unique,
  alternate_emails text[] not null default '{}',
  role             public.user_role not null default 'artist',
  active           boolean not null default true,
  home_screen      text not null default 'dashboard',
  phone_type       public.phone_type not null default 'unknown',
  created_at       timestamptz not null default now(),
  edited_by        uuid references public.profiles (id),
  edited_at        timestamptz
);

alter table public.profiles enable row level security;

-- Is the signed-in user an active manager?  SECURITY DEFINER so it can read
-- profiles without triggering the profiles policies (which call this function).
create or replace function app.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
      and p.active
  )
$$;

-- Is the signed-in user an active account of any role?
create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
  )
$$;

create policy "profiles: read own row"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles: managers read all"
  on public.profiles for select to authenticated
  using ((select app.is_manager()));

create policy "profiles: managers insert"
  on public.profiles for insert to authenticated
  with check ((select app.is_manager()));

create policy "profiles: update own row or any as manager"
  on public.profiles for update to authenticated
  using (id = auth.uid() or (select app.is_manager()))
  with check (id = auth.uid() or (select app.is_manager()));

-- No delete policy: accounts are deactivated, never deleted, so history keeps
-- its author.

-- Only a manager may change role, active flag or login email.  Owners can
-- still update their own preferences (home screen, phone type).
create or replace function app.protect_profile_fields()
returns trigger
language plpgsql
as $$
begin
  if app.is_app_user() and not (select app.is_manager()) then
    if new.role      is distinct from old.role
    or new.active    is distinct from old.active
    or new.email     is distinct from old.email
    or new.id        is distinct from old.id
    or new.full_name is distinct from old.full_name
    then
      raise exception 'Only a manager can change a role, active flag, login email or name'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function app.protect_profile_fields();

create trigger profiles_set_edited
  before update on public.profiles
  for each row execute function app.set_edited();

-- Every new auth user gets a profile.  Role is always 'artist' here; only an
-- existing manager (or the seed script with the service role) can promote.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    'artist'
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Keep the login email on the profile in step with the auth record.
create or replace function app.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function app.handle_user_email_change();

-- Names and roles for everyone, readable by any signed-in account.  The view
-- runs with its owner's rights (not the caller's), which is what lets artists
-- see other people's names without seeing their full profile rows.
create view public.people as
  select id, full_name, role, active
  from public.profiles;

revoke all on public.people from anon, public;
grant select on public.people to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- pay_rates â€” manager-only.  Insert-only: a rate is never updated or deleted,
-- a new dated row is added instead.  Where two rows share a date, the one
-- added last wins (so a typo can be corrected without losing history).
-- -----------------------------------------------------------------------------
create table public.pay_rates (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles (id),
  hourly_rate    numeric(10, 2) not null check (hourly_rate >= 0),
  effective_from date not null default app.today(),
  created_by     uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create index pay_rates_profile_date on public.pay_rates (profile_id, effective_from desc, created_at desc);

alter table public.pay_rates enable row level security;

create policy "pay_rates: managers read"
  on public.pay_rates for select to authenticated
  using ((select app.is_manager()));

create policy "pay_rates: managers insert"
  on public.pay_rates for insert to authenticated
  with check ((select app.is_manager()));

-- Deliberately no update or delete policy (rule 5: never update a rate row).

create or replace function app.block_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Rows in % are never updated or deleted; add a new row instead', tg_table_name
    using errcode = '42501';
end
$$;

create trigger pay_rates_immutable
  before update or delete on public.pay_rates
  for each row execute function app.block_change();

-- The rate in force for a person on a given date (null when none has been set).
create or replace function app.rate_on(p_profile_id uuid, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select r.hourly_rate
  from public.pay_rates r
  where r.profile_id = p_profile_id
    and r.effective_from <= p_date
  order by r.effective_from desc, r.created_at desc
  limit 1
$$;

-- -----------------------------------------------------------------------------
-- designs â€” the reusable thing an order is a run of.  Readable by everyone,
-- maintained by managers.  Price lives in design_prices, never here.
-- -----------------------------------------------------------------------------
create table public.designs (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  product_image_path text,                 -- object path in the design-photos bucket
  dimensions         text,
  colors_finishes    text,
  instructions       text,
  has_dabber         boolean not null default false,
  is_fumed           boolean not null default false,
  active             boolean not null default true,
  created_by         uuid references public.profiles (id) default auth.uid(),
  created_at         timestamptz not null default now(),
  edited_by          uuid references public.profiles (id),
  edited_at          timestamptz
);

create unique index designs_name_unique on public.designs (lower(name));

alter table public.designs enable row level security;

create policy "designs: everyone reads"
  on public.designs for select to authenticated
  using ((select app.is_active_user()));

create policy "designs: managers insert"
  on public.designs for insert to authenticated
  with check ((select app.is_manager()));

create policy "designs: managers update"
  on public.designs for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy "designs: managers delete"
  on public.designs for delete to authenticated
  using ((select app.is_manager()));

create trigger designs_set_edited
  before update on public.designs
  for each row execute function app.set_edited();

-- -----------------------------------------------------------------------------
-- design_prices â€” manager-only, dated, insert-only (like pay_rates).
-- -----------------------------------------------------------------------------
create table public.design_prices (
  id               uuid primary key default gen_random_uuid(),
  design_id        uuid not null references public.designs (id) on delete cascade,
  price_per_bottle numeric(10, 2) not null check (price_per_bottle >= 0),
  effective_from   date not null default app.today(),
  created_by       uuid references public.profiles (id) default auth.uid(),
  created_at       timestamptz not null default now()
);

create index design_prices_design_date on public.design_prices (design_id, effective_from desc, created_at desc);

alter table public.design_prices enable row level security;

create policy "design_prices: managers read"
  on public.design_prices for select to authenticated
  using ((select app.is_manager()));

create policy "design_prices: managers insert"
  on public.design_prices for insert to authenticated
  with check ((select app.is_manager()));

create trigger design_prices_immutable
  before update or delete on public.design_prices
  for each row execute function app.block_change();

-- -----------------------------------------------------------------------------
-- design_photos â€” reference photos; files live in the design-photos bucket.
-- -----------------------------------------------------------------------------
create table public.design_photos (
  id           uuid primary key default gen_random_uuid(),
  design_id    uuid not null references public.designs (id) on delete cascade,
  storage_path text not null unique,
  caption      text,
  sort_order   integer not null default 0,
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);

alter table public.design_photos enable row level security;

create policy "design_photos: everyone reads"
  on public.design_photos for select to authenticated
  using ((select app.is_active_user()));

create policy "design_photos: managers insert"
  on public.design_photos for insert to authenticated
  with check ((select app.is_manager()));

create policy "design_photos: managers update"
  on public.design_photos for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy "design_photos: managers delete"
  on public.design_photos for delete to authenticated
  using ((select app.is_manager()));
