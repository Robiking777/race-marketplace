-- Alerts, notifications and listings fan-out support

-- Copy of public listings used for centralised matching
create table if not exists public.listings (
  id text primary key,
  type text not null check (type in ('sell','buy')),
  race_name text not null,
  edition_id bigint,
  edition_event_name text,
  edition_year integer,
  edition_start_date date,
  distance text,
  price numeric(12,2) not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  location text,
  created_at timestamptz not null default now(),
  payload jsonb
);

create index if not exists listings_owner_id_idx on public.listings(owner_id);
create index if not exists listings_created_at_idx on public.listings(created_at desc);
create index if not exists listings_edition_id_idx on public.listings(edition_id);

alter table public.listings enable row level security;

drop policy if exists "Public listings read access" on public.listings;
create policy "Public listings read access" on public.listings
for select
using (true);

drop policy if exists "Owners manage listings" on public.listings;
create policy "Owners manage listings" on public.listings
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Alerts created by users
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'any' check (mode in ('sell','buy','any')),
  event_id bigint,
  event_label text,
  query_text text,
  distance text,
  max_price numeric(12,2),
  send_email boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (coalesce(trim(query_text), '') <> '' or event_id is not null)
);

create index if not exists alerts_user_id_idx on public.alerts(user_id);
create index if not exists alerts_active_idx on public.alerts(is_active);

alter table public.alerts enable row level security;

drop policy if exists "Users read own alerts" on public.alerts;
create policy "Users read own alerts" on public.alerts
for select
using (user_id = auth.uid());

drop policy if exists "Users manage own alerts" on public.alerts;
create policy "Users manage own alerts" on public.alerts
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Delivered notifications snapshot
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id text references public.listings(id) on delete set null,
  channel text not null check (channel in ('inapp','email')),
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  payload jsonb
);

create index if not exists notifications_user_id_idx on public.notifications(user_id);
create index if not exists notifications_is_read_idx on public.notifications(is_read);
create index if not exists notifications_listing_id_idx on public.notifications(listing_id);

alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications
for select
using (user_id = auth.uid());

drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications" on public.notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users delete own notifications" on public.notifications;
create policy "Users delete own notifications" on public.notifications
for delete
using (user_id = auth.uid());

-- View that returns all matching alert/user pairs for a listing
create or replace view public.alerts_match as
select
  l.id as listing_id,
  a.id as alert_id,
  a.user_id,
  a.send_email,
  a.mode,
  a.max_price,
  a.distance,
  a.event_id,
  a.event_label,
  a.query_text
from public.listings l
join public.alerts a
  on a.is_active
  and (a.mode = 'any' or a.mode = l.type)
  and (
    (a.event_id is not null and a.event_id = l.edition_id)
    or (
      a.event_id is null
      and coalesce(trim(a.query_text), '') <> ''
      and position(lower(trim(a.query_text)) in lower(l.race_name)) > 0
    )
  )
  and (
    a.distance is null
    or coalesce(trim(a.distance), '') = ''
    or a.distance = l.distance
  )
  and (
    a.max_price is null
    or l.price <= a.max_price
  );

grant select on public.alerts_match to service_role;

alter table public.profiles add column if not exists email_notifications boolean not null default false;
