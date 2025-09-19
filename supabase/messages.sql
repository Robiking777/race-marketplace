-- profiles (jeśli nie istnieje)
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- messages (proste 1:1, bez wątków)
create table if not exists public.messages(
  id bigserial primary key,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  listing_id text,
  body text not null check (length(body) <= 4000),
  created_at timestamptz default now(),
  read_at timestamptz
);

-- RLS
alter table public.profiles enable row level security;
alter table public.messages enable row level security;

-- Profile: każdy czyta tylko siebie, zapis: tylko właściciel
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);
create policy "profiles_upsert_own" on public.profiles
for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id);

-- Messages: nadawca lub odbiorca może czytać; wysyła tylko zalogowany jako from_user; read_at ustawia tylko odbiorca
create policy "messages_select_participant" on public.messages
for select using (auth.uid() = from_user or auth.uid() = to_user);
create policy "messages_insert_self_sender" on public.messages
for insert with check (auth.uid() = from_user);
create policy "messages_update_mark_read" on public.messages
for update using (auth.uid() = to_user);
