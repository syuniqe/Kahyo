-- Kahyo beta: traction numbers. Run once in Supabase → SQL Editor → New query → Run,
-- after schema.sql. Safe to run again.
-- Every save of a Journey adds to one row per writer per day: how many Footsteps they
-- added and which Journeys they touched. No story text is copied here.

create table if not exists public.activity (
  user_id   uuid    not null references auth.users (id) on delete cascade,
  day       date    not null,
  footsteps integer not null default 0,  -- Footsteps added that day (deletions don't subtract)
  journeys  text[]  not null default '{}', -- ids of the Journeys saved that day
  primary key (user_id, day)
);

-- Nobody reads this from the app: only the dashboard (service role) and the SQL editor.
alter table public.activity enable row level security;
revoke all on public.activity from anon, authenticated;

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer := coalesce(jsonb_array_length(new.data -> 'footsteps'), 0)
                 - case when tg_op = 'UPDATE' then coalesce(jsonb_array_length(old.data -> 'footsteps'), 0) else 0 end;
begin
  insert into public.activity as a (user_id, day, footsteps, journeys)
  values (new.user_id, (now() at time zone 'Asia/Kolkata')::date, greatest(added, 0), array[new.id])
  on conflict (user_id, day) do update
    set footsteps = a.footsteps + excluded.footsteps,
        journeys  = case when new.id = any (a.journeys) then a.journeys else a.journeys || new.id end;
  return new;
end;
$$;

drop trigger if exists journeys_activity on public.journeys;
create trigger journeys_activity
  after insert or update of data on public.journeys
  for each row execute function public.log_activity();

-- Start from what is already saved: each Journey's Footsteps count on the day it was last edited.
insert into public.activity (user_id, day, footsteps, journeys)
select user_id, (updated_at at time zone 'Asia/Kolkata')::date,
       sum(coalesce(jsonb_array_length(data -> 'footsteps'), 0)), array_agg(id)
from public.journeys
group by 1, 2
on conflict (user_id, day) do nothing;

-- The weekly numbers for the deck. Weeks start on Monday (India time).
-- An active writer added 3 or more Footsteps that week; "returning" were active the week before too.
create or replace view public.traction_weekly
with (security_invoker = true) as
with weeks as (
  select user_id, date_trunc('week', day)::date as week, sum(footsteps) as footsteps
  from public.activity
  group by 1, 2
),
firsts as (
  select id as user_id, date_trunc('week', (created_at at time zone 'Asia/Kolkata'))::date as week
  from auth.users
)
select w.week,
       (select count(*) from firsts f where f.week = w.week)                         as new_writers,
       count(*) filter (where w.footsteps >= 3)                                       as active_writers,
       count(*) filter (where w.footsteps >= 3 and exists (
         select 1 from weeks p where p.user_id = w.user_id and p.week = w.week - 7 and p.footsteps >= 3)) as returning_writers,
       sum(w.footsteps)                                                               as footsteps
from weeks w
group by w.week
order by w.week desc;

revoke all on public.traction_weekly from anon, authenticated;

-- See the numbers:  select * from public.traction_weekly;
-- Totals so far:    select (select count(*) from auth.users) as writers,
--                          (select count(*) from public.journeys) as journeys,
--                          (select sum(footsteps) from public.activity) as footsteps;
