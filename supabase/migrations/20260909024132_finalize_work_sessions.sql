alter table public.work_sessions
  add column if not exists locked_at timestamptz,
  add column if not exists locked_report_code text;

alter table public.finalized_reports
  add column if not exists work_session_id uuid references public.work_sessions(id) on delete set null,
  add column if not exists report_type text not null default 'task_selection';

do $$ begin
  alter table public.finalized_reports
    add constraint finalized_reports_report_type_check
    check (report_type in ('task_selection','work_session'));
exception when duplicate_object then null; end $$;

create index if not exists finalized_reports_session_idx
  on public.finalized_reports(work_session_id, finalized_at desc)
  where work_session_id is not null;

create unique index if not exists finalized_reports_session_version_idx
  on public.finalized_reports(work_session_id, version_no)
  where work_session_id is not null;

create or replace function public.finalize_work_session(
  p_work_session_id uuid,
  p_title text,
  p_snapshot jsonb,
  p_report_options jsonb default '{}'::jsonb
)
returns public.finalized_reports
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.work_sessions;
  v_report public.finalized_reports;
  v_code text;
  v_entry_ids uuid[];
  v_total integer;
  v_ready integer;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_session
  from public.work_sessions
  where id = p_work_session_id
    and user_id = v_uid
    and status = 'completed'
    and locked_at is null;

  if not found then raise exception 'Completed unlocked work session not found'; end if;

  select
    coalesce(array_agg(id order by started_at), '{}'::uuid[]),
    count(*),
    count(*) filter (where status = 'completed' and locked_at is null)
  into v_entry_ids, v_total, v_ready
  from public.work_entries
  where work_session_id = p_work_session_id
    and employee_id = v_uid
    and deleted_at is null;

  if v_total = 0 then raise exception 'Work session has no tasks'; end if;
  if v_ready <> v_total then raise exception 'All session tasks must be completed and unlocked'; end if;

  v_code := 'WWS-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));

  insert into public.finalized_reports(
    user_id, report_code, title, period_start, period_end, entry_ids, snapshot,
    work_session_id, report_type, report_options, status
  ) values (
    v_uid, v_code, coalesce(nullif(trim(p_title),''),'Work Session Record'),
    v_session.started_at::date, coalesce(v_session.ended_at, v_session.started_at)::date,
    v_entry_ids, coalesce(p_snapshot,'{}'::jsonb), p_work_session_id, 'work_session',
    coalesce(p_report_options,'{}'::jsonb), 'finalized'
  ) returning * into v_report;

  update public.work_entries
  set locked_at = now(), locked_report_code = v_code
  where id = any(v_entry_ids) and employee_id = v_uid;

  update public.work_sessions
  set locked_at = now(), locked_report_code = v_code
  where id = p_work_session_id and user_id = v_uid;

  return v_report;
end;
$$;

grant execute on function public.finalize_work_session(uuid,text,jsonb,jsonb) to authenticated;

create or replace function public.create_report_revision(
  p_parent_report_id uuid,
  p_title text,
  p_snapshot jsonb,
  p_reason text,
  p_report_options jsonb default '{}'::jsonb
)
returns public.finalized_reports
language plpgsql security definer set search_path=public,private as $$
declare
  v_uid uuid:=auth.uid();
  v_parent public.finalized_reports;
  v_report public.finalized_reports;
  v_version integer;
  v_root uuid;
  v_code text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_parent from public.finalized_reports where id=p_parent_report_id and user_id=v_uid;
  if not found then raise exception 'Parent report not found'; end if;
  v_root := coalesce(v_parent.parent_report_id, v_parent.id);
  select coalesce(max(version_no),1)+1 into v_version from public.finalized_reports where id=v_root or parent_report_id=v_root;
  v_code := regexp_replace(v_parent.report_code, '-V[0-9]+$', '') || '-V' || v_version::text;
  insert into public.finalized_reports(
    user_id,report_code,title,period_start,period_end,entry_ids,snapshot,parent_report_id,
    version_no,amendment_reason,report_options,status,work_session_id,report_type
  ) values(
    v_uid,v_code,coalesce(nullif(trim(p_title),''),v_parent.title),v_parent.period_start,v_parent.period_end,
    v_parent.entry_ids,p_snapshot,v_root,v_version,coalesce(p_reason,''),coalesce(p_report_options,'{}'::jsonb),
    'finalized',v_parent.work_session_id,v_parent.report_type
  ) returning * into v_report;
  return v_report;
end;
$$;

grant execute on function public.create_report_revision(uuid,text,jsonb,text,jsonb) to authenticated;