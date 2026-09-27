create extension if not exists pgcrypto;

create or replace function public.array_sum_int(values int[])
returns int
language sql
immutable
strict
as $$
  select coalesce(sum(value), 0)::int
  from unnest(values) as value;
$$;

create table public.courses (
  id text primary key,
  version int not null,
  par int[] not null,
  name text not null
);

create table public.course_stats (
  course_id text primary key references public.courses(id) on delete cascade,
  plays int not null default 0
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  course_id text not null references public.courses(id),
  course_version int not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed bool not null default false,
  client_ip_hash text not null
);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.runs(id),
  course_id text not null references public.courses(id),
  player_name text not null check (char_length(player_name) between 1 and 20),
  hole_strokes int[] not null,
  total_strokes int generated always as (public.array_sum_int(hole_strokes)) stored,
  to_par int not null,
  shots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index scores_course_total_created_idx
  on public.scores(course_id, total_strokes, created_at);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

alter table public.courses enable row level security;
alter table public.course_stats enable row level security;
alter table public.runs enable row level security;
alter table public.scores enable row level security;
alter table public.rate_limits enable row level security;

create or replace function public.check_rate_limit(
  p_key text,
  p_limit int,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz := now();
  allowed boolean;
begin
  insert into public.rate_limits(key, window_start, count)
  values (p_key, current_window, 1)
  on conflict (key) do update
    set window_start = case
      when current_window - rate_limits.window_start >= p_window then current_window
      else rate_limits.window_start
    end,
    count = case
      when current_window - rate_limits.window_start >= p_window then 1
      else rate_limits.count + 1
    end;

  select count <= p_limit
    into allowed
    from public.rate_limits
   where key = p_key;
  return allowed;
end;
$$;

create or replace function public.finish_run(
  p_run_id uuid,
  p_token_hash text,
  p_player_name text,
  p_hole_strokes int[],
  p_shots jsonb
)
returns table(score_id uuid, total_strokes int, to_par int, rank bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket public.runs%rowtype;
  course public.courses%rowtype;
  inserted_score public.scores%rowtype;
begin
  select * into ticket
    from public.runs
   where id = p_run_id
   for update;
  if not found then raise exception 'run_not_found'; end if;
  if ticket.expires_at <= now() then raise exception 'run_expired'; end if;
  if ticket.consumed then raise exception 'run_consumed'; end if;
  if ticket.token_hash <> p_token_hash then raise exception 'invalid_token'; end if;

  select * into course from public.courses where id = ticket.course_id;
  if coalesce(array_length(p_hole_strokes, 1), 0) <> coalesce(array_length(course.par, 1), 0) then
    raise exception 'invalid_hole_count';
  end if;
  if exists (select 1 from unnest(p_hole_strokes) as stroke where stroke < 1 or stroke > 20) then
    raise exception 'invalid_hole_strokes';
  end if;
  if char_length(p_player_name) < 1 or char_length(p_player_name) > 20 then
    raise exception 'invalid_player_name';
  end if;

  update public.runs set consumed = true where id = p_run_id;
  insert into public.scores(run_id, course_id, player_name, hole_strokes, to_par, shots)
  values (
    p_run_id,
    ticket.course_id,
    p_player_name,
    p_hole_strokes,
    public.array_sum_int(p_hole_strokes) - public.array_sum_int(course.par),
    coalesce(p_shots, '[]'::jsonb)
  )
  returning * into inserted_score;

  insert into public.course_stats(course_id, plays)
  values (ticket.course_id, 1)
  on conflict (course_id) do update set plays = public.course_stats.plays + 1;

  return query
  select inserted_score.id,
         inserted_score.total_strokes,
         inserted_score.to_par,
         (
           select count(*) + 1
             from public.scores other
            where other.course_id = inserted_score.course_id
              and (other.total_strokes, other.created_at) <
                  (inserted_score.total_strokes, inserted_score.created_at)
         )::bigint;
end;
$$;

insert into public.courses(id, version, par, name)
values ('pinecrest', 1, array[4, 3, 5], 'Pinecrest')
on conflict (id) do nothing;

insert into public.course_stats(course_id, plays)
values ('pinecrest', 0)
on conflict (course_id) do nothing;
