-- Dodaj pola na nazwy, żeby nie trzeba było ściągać ich z profiles (RLS)
alter table public.messages
  add column if not exists from_display_name text,
  add column if not exists to_display_name   text;

-- Indeksy pod badge i wątki
create index if not exists idx_messages_to_unread on public.messages (to_user) where read_at is null;
create index if not exists idx_messages_pair on public.messages (from_user, to_user);

-- (jeśli Realtime nie było włączone)
-- w panelu Database → Replication dodaj table public.messages
-- lub zostaw ten komentarz, QA zaznaczy ręcznie
