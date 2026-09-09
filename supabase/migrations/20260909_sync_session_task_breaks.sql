alter table public.work_sessions
  add column if not exists auto_paused_task_ids uuid[] not null default '{}'::uuid[];

create or replace function public.pause_work_session_with_tasks(p_work_session_id uuid)
returns public.work_sessions
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.work_sessions;
  v_now timestamptz := now();
  v_task_ids uuid[] := '{}'::uuid[];
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_session
  from public.work_sessions
  where id = p_work_session_id and user_id = v_uid and status = 'active'
  for update;

  if not found then raise exception 'Active work session not found'; end if;

  select coalesce(array_agg(id order by started_at), '{}'::uuid[]) into v_task_ids
  from public.work_entries
  where employee_id = v_uid
    and work_session_id = p_work_session_id
    and status = 'active'
    and ended_at is null;

  if cardinality(v_task_ids) > 0 then
    update public.work_entries
    set status = 'paused', paused_at = v_now
    where id = any(v_task_ids)
      and employee_id = v_uid
      and work_session_id = p_work_session_id
      and status = 'active';
  end if;

  update public.work_sessions
  set status = 'paused', paused_at = v_now, auto_paused_task_ids = v_task_ids
  where id = p_work_session_id and user_id = v_uid
  returning * into v_session;

  return v_session;
end;
$$;

create or replace function public.resume_work_session_with_tasks(p_work_session_id uuid)
returns public.work_sessions
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.work_sessions;
  v_now timestamptz := now();
  v_extra integer := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_session
  from public.work_sessions
  where id = p_work_session_id and user_id = v_uid and status = 'paused'
  for update;

  if not found then raise exception 'Paused work session not found'; end if;

  if v_session.paused_at is not null then
    v_extra := greatest(0, floor(extract(epoch from (v_now - v_session.paused_at)))::integer);
  end if;

  if cardinality(coalesce(v_session.auto_paused_task_ids, '{}'::uuid[])) > 0 then
    update public.work_entries
    set status = 'active',
        paused_at = null,
        break_seconds = coalesce(break_seconds, 0) + v_extra
    where id = any(v_session.auto_paused_task_ids)
      and employee_id = v_uid
      and work_session_id = p_work_session_id
      and status = 'paused'
      and ended_at is null;
  end if;

  update public.work_sessions
  set status = 'active',
      paused_at = null,
      break_seconds = coalesce(break_seconds, 0) + v_extra,
      auto_paused_task_ids = '{}'::uuid[]
  where id = p_work_session_id and user_id = v_uid
  returning * into v_session;

  return v_session;
end;
$$;

grant execute on function public.pause_work_session_with_tasks(uuid) to authenticated;
grant execute on function public.resume_work_session_with_tasks(uuid) to authenticated;