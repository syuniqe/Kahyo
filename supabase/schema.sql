-- Kahyo beta: run once in Supabase → SQL Editor → New query → Run.
-- One row per Journey, owned by the person who made it.

create table if not exists public.journeys (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  title      text        not null default 'Untitled Journey',
  nsmm       text        not null default 'wordwalk',
  summary    jsonb       not null default '{}'::jsonb,  -- what the Home card shows
  data       jsonb       not null,                      -- the whole Journey
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists journeys_user_updated on public.journeys (user_id, updated_at desc);

-- Row level security: a person can only see and change their own Journeys.
alter table public.journeys enable row level security;

drop policy if exists "own journeys: read"   on public.journeys;
drop policy if exists "own journeys: add"    on public.journeys;
drop policy if exists "own journeys: change" on public.journeys;
drop policy if exists "own journeys: delete" on public.journeys;

create policy "own journeys: read"   on public.journeys for select to authenticated using (user_id = auth.uid());
create policy "own journeys: add"    on public.journeys for insert to authenticated with check (user_id = auth.uid());
create policy "own journeys: change" on public.journeys for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own journeys: delete" on public.journeys for delete to authenticated using (user_id = auth.uid());

revoke all on public.journeys from anon;
grant select, insert, update, delete on public.journeys to authenticated;

-- "Delete my account": removes the caller and, through the cascade, their Journeys.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
