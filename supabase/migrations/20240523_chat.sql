-- Chat tables and policies for 1:1 listing conversations

-- Threads store a single conversation around a listing
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists threads_listing_id_idx on public.threads(listing_id);

-- Participants reference auth.users and connect people to a thread
create table if not exists public.thread_participants (
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists thread_participants_user_id_idx on public.thread_participants(user_id);

-- Messages exchanged inside a thread
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists messages_thread_id_idx on public.messages(thread_id);
create index if not exists messages_sender_id_idx on public.messages(sender_id);
create index if not exists messages_read_at_idx on public.messages(read_at);

-- Enable RLS
alter table public.threads enable row level security;
alter table public.thread_participants enable row level security;
alter table public.messages enable row level security;

-- Threads: a user can see threads where they are a participant
drop policy if exists "Participants can view threads" on public.threads;
create policy "Participants can view threads" on public.threads
for select
using (
  exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = threads.id
      and tp.user_id = auth.uid()
  )
);

-- Allow authenticated users to create a thread
drop policy if exists "Authenticated users can create threads" on public.threads;
create policy "Authenticated users can create threads" on public.threads
for insert
with check (auth.role() = 'authenticated');

-- Thread participants policies
drop policy if exists "Participants can view members" on public.thread_participants;
create policy "Participants can view members" on public.thread_participants
for select
using (
  exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = thread_participants.thread_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists "Users can join threads" on public.thread_participants;
create policy "Users can join threads" on public.thread_participants
for insert
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = thread_participants.thread_id
      and tp.user_id = auth.uid()
  )
);

-- Messages policies
drop policy if exists "Participants can view messages" on public.messages;
create policy "Participants can view messages" on public.messages
for select
using (
  exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = messages.thread_id
      and tp.user_id = auth.uid()
  )
);

drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages" on public.messages
for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = messages.thread_id
      and tp.user_id = auth.uid()
  )
);

-- RPC to mark all messages in a thread as read by the current user
create or replace function public.mark_thread_messages_read(thread_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages m
  set read_at = now()
  where m.thread_id = thread_id_input
    and m.read_at is null
    and m.sender_id <> auth.uid()
    and exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = thread_id_input
        and tp.user_id = auth.uid()
    );
end;
$$;

grant execute on function public.mark_thread_messages_read(uuid) to authenticated;
