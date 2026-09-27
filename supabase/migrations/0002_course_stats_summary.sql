create or replace function public.course_stats_summary(p_course_id text)
returns table(plays int, best_score int, average_score numeric)
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce((select cs.plays from public.course_stats cs where cs.course_id = p_course_id), 0)::int,
    min(s.total_strokes)::int,
    avg(s.total_strokes)::numeric
  from public.scores s
  where s.course_id = p_course_id;
$$;
