-- Personal WorkWatch productivity suite
alter table public.work_entries add column if not exists client_label text not null default '';
alter table public.work_entries add column if not exists project_label text not null default '';
alter table public.work_entries add column if not exists locked_at timestamptz;
alter table public.work_entries add column if not exists locked_report_code text;
alter table public.work_entry_during_evidence add column if not exists caption text not null default '';

create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 500),
  client_label text not null default '',
  project_label text not null default '',
  favorite boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  summary_date date not null,
  completed_text text not null default '',
  issues_text text not null default '',
  next_actions_text text not null default '',
  updated_at timestamptz not null default now(),
  unique(user_id, summary_date)
);

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  workday_target_minutes integer not null default 480 check (workday_target_minutes between 0 and 1440),
  compression_enabled boolean not null default true,
  max_image_width integer not null default 1920 check (max_image_width between 640 and 4096),
  image_quality numeric(3,2) not null default 0.84 check (image_quality between 0.40 and 1.00),
  updated_at timestamptz not null default now()
);

create table if not exists public.finalized_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  report_code text not null unique,
  title text not null default 'WorkWatch Time Record',
  period_start date not null,
  period_end date not null,
  entry_ids uuid[] not null default '{}',
  snapshot jsonb not null default '{}'::jsonb,
  finalized_at timestamptz not null default now(),
  share_token text unique,
  share_expires_at timestamptz,
  share_revoked_at timestamptz
);

create table if not exists public.report_submissions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finalized_reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  recipient text not null default '',
  channel text not null default '',
  notes text not null default '',
  submitted_at timestamptz not null default now()
);

create index if not exists task_templates_user_idx on public.task_templates(user_id, created_at desc);
create index if not exists daily_summaries_user_date_idx on public.daily_summaries(user_id, summary_date desc);
create index if not exists finalized_reports_user_idx on public.finalized_reports(user_id, finalized_at desc);
create index if not exists finalized_reports_share_token_idx on public.finalized_reports(share_token) where share_token is not null;
create index if not exists report_submissions_report_idx on public.report_submissions(report_id, submitted_at desc);

alter table public.task_templates enable row level security;
alter table public.daily_summaries enable row level security;
alter table public.user_preferences enable row level security;
alter table public.finalized_reports enable row level security;
alter table public.report_submissions enable row level security;

drop policy if exists task_templates_own_all on public.task_templates;
create policy task_templates_own_all on public.task_templates for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists daily_summaries_own_all on public.daily_summaries;
create policy daily_summaries_own_all on public.daily_summaries for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists user_preferences_own_all on public.user_preferences;
create policy user_preferences_own_all on public.user_preferences for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists finalized_reports_own_all on public.finalized_reports;
create policy finalized_reports_own_all on public.finalized_reports for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists report_submissions_own_all on public.report_submissions;
create policy report_submissions_own_all on public.report_submissions for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists during_evidence_update_own on public.work_entry_during_evidence;
create policy during_evidence_update_own on public.work_entry_during_evidence for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.task_templates, public.daily_summaries, public.user_preferences, public.finalized_reports, public.report_submissions to authenticated;
grant update on public.work_entry_during_evidence to authenticated;
revoke all on public.finalized_reports from anon;
revoke all on public.report_submissions from anon;

create or replace function public.finalize_personal_report(
  p_title text,
  p_period_start date,
  p_period_end date,
  p_entry_ids uuid[],
  p_snapshot jsonb
)
returns public.finalized_reports
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_report public.finalized_reports;
  v_code text;
  v_owned integer;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_entry_ids is null or cardinality(p_entry_ids) = 0 then raise exception 'No entries selected'; end if;
  select count(*) into v_owned from public.work_entries where id = any(p_entry_ids) and employee_id = v_uid and status = 'completed' and locked_at is null;
  if v_owned <> cardinality(p_entry_ids) then raise exception 'All selected entries must be your unlocked completed records'; end if;
  v_code := 'WW-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.finalized_reports(user_id,report_code,title,period_start,period_end,entry_ids,snapshot)
  values(v_uid,v_code,coalesce(nullif(trim(p_title),''),'WorkWatch Time Record'),p_period_start,p_period_end,p_entry_ids,p_snapshot)
  returning * into v_report;
  update public.work_entries set locked_at = now(), locked_report_code = v_code where id = any(p_entry_ids) and employee_id = v_uid;
  return v_report;
end;
$$;
grant execute on function public.finalize_personal_report(text,date,date,uuid[],jsonb) to authenticated;

create or replace function private.protect_locked_work_entry()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if old.locked_at is not null then raise exception 'This work entry is locked by finalized report %', old.locked_report_code; end if;
  return old;
end;
$$;
revoke all on function private.protect_locked_work_entry() from public;
drop trigger if exists protect_locked_work_entry_delete on public.work_entries;
create trigger protect_locked_work_entry_delete before delete on public.work_entries for each row execute function private.protect_locked_work_entry();

create or replace function private.protect_work_entry_history()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if old.locked_at is not null then raise exception 'This work entry is locked by finalized report %', old.locked_report_code; end if;
  if old.status = 'completed' and not private.is_system_admin() then raise exception 'Completed work entries are immutable'; end if;
  if new.employee_id <> old.employee_id or new.organization_id <> old.organization_id then raise exception 'Work entry ownership cannot be changed'; end if;
  return new;
end;
$$;
revoke all on function private.protect_work_entry_history() from public;
drop trigger if exists protect_work_entry_history on public.work_entries;
create trigger protect_work_entry_history before update on public.work_entries for each row execute function private.protect_work_entry_history();

insert into public.user_preferences(user_id) select id from public.profiles on conflict (user_id) do nothing;
