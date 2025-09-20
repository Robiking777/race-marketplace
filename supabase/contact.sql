create table if not exists public.contact_messages(
  id bigserial primary key,
  user_id uuid,
  display_name text,
  email text,
  kind text check (kind in ('Pomysł','Problem','Błąd','Współpraca')) not null,
  subject text not null,
  body text not null,
  url_path text,
  user_agent text,
  created_at timestamptz default now(),
  status text default 'new' check (status in ('new','seen','resolved'))
);

alter table public.contact_messages enable row level security;

-- Wstawiać może każdy (także niezalogowany)
create policy contact_insert_any on public.contact_messages
for insert with check (true);

-- Odczyt: tylko właściciel swoich wpisów (jeśli zalogowany); publicznie brak
create policy contact_select_own on public.contact_messages
for select using (auth.uid() is not null and auth.uid() = user_id);
