-- Full personal WorkWatch client workflow suite

alter table public.work_entries add column if not exists deleted_at timestamptz;
alter table public.work_entries add column if not exists delete_reason text not null default '';
alter table public.work_entries add column if not exists manual_entry boolean not null default false;
alter table public.work_entries add column if not exists manual_reason text not null default '';

alter table public.work_entries drop constraint if exists work_entries_state_check;
alter table public.work_entries add constraint work_entries_state_check check (
  ((status = any (array['active'::text,'paused'::text])) and ended_at is null and after_path is null)
  or
  ((status = 'completed'::text) and ended_at is not null and (after_path is not null or manual_entry = true))
);

alter table public.user_preferences add column if not exists watermark_enabled boolean not null default true;
alter table public.user_preferences add column if not exists watermark_text text not null default 'WorkWatch';
alter table public.user_preferences add column if not exists idle_prompt_minutes integer not null default 15 check (idle_prompt_minutes between 5 and 180);
alter table public.user_preferences add column if not exists focus_work_minutes integer not null default 50 check (focus_work_minutes between 5 and 180);
alter table public.user_preferences add column if not exists focus_break_minutes integer not null default 10 check (focus_break_minutes between 1 and 60);

alter table public.finalized_reports add column if not exists parent_report_id uuid references public.finalized_reports(id) on delete set null;
alter table public.finalized_reports add column if not exists version_no integer not null default 1 check (version_no >= 1);
alter table public.finalized_reports add column if not exists amendment_reason text not null default '';
alter table public.finalized_reports add column if not exists verification_code text;
alter table public.finalized_reports add column if not exists report_options jsonb not null default '{}'::jsonb;
alter table public.finalized_reports add column if not exists status text not null default 'finalized';
alter table public.finalized_reports add column if not exists first_viewed_at timestamptz;
alter table public.finalized_reports add column if not exists last_viewed_at timestamptz;
alter table public.finalized_reports add column if not exists view_count integer not null default 0 check (view_count >= 0);
alter table public.finalized_reports add column if not exists acknowledged_at timestamptz;

update public.finalized_reports
set verification_code = upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))
where verification_code is null;
alter table public.finalized_reports alter column verification_code set default upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
alter table public.finalized_reports alter column verification_code set not null;

do $$ begin
  alter table public.finalized_reports add constraint finalized_reports_status_check check (status in ('draft','finalized','sent','viewed','acknowledged','revoked'));
exception when duplicate_object then null; end $$;

create unique index if not exists finalized_reports_verification_idx on public.finalized_reports(verification_code);
create index if not exists finalized_reports_parent_idx on public.finalized_reports(parent_report_id, version_no desc);

create table if not exists public.client_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text not null default '',
  default_project text not null default '',
  preferred_channel text not null default 'Email',
  instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);

create table if not exists public.work_entry_checklist (
  id uuid primary key default gen_random_uuid(),
  work_entry_id uuid not null references public.work_entries(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_text text not null check (char_length(item_text) between 1 and 300),
  completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.evidence_integrity (
  path text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sha256 text not null,
  original_size_bytes bigint not null default 0,
  stored_size_bytes bigint not null default 0,
  mime_type text not null default '',
  watermarked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.work_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  journal_date date not null default current_date,
  title text not null default '',
  body text not null default '',
  tags text[] not null default '{}',
  related_entry_id uuid references public.work_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_view_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finalized_reports(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  user_agent text not null default '',
  ip_hash text not null default ''
);

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_entry_id uuid references public.work_entries(id) on delete set null,
  work_minutes integer not null check (work_minutes between 1 and 240),
  break_minutes integer not null default 0 check (break_minutes between 0 and 120),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','cancelled'))
);

create index if not exists client_presets_user_idx on public.client_presets(user_id, name);
create index if not exists checklist_entry_idx on public.work_entry_checklist(work_entry_id, sort_order);
create index if not exists evidence_integrity_user_idx on public.evidence_integrity(user_id, created_at desc);
create index if not exists journal_user_date_idx on public.work_journal(user_id, journal_date desc);
create index if not exists report_view_events_report_idx on public.report_view_events(report_id, viewed_at desc);
create index if not exists focus_sessions_user_idx on public.focus_sessions(user_id, started_at desc);
create index if not exists work_entries_trash_idx on public.work_entries(employee_id, deleted_at desc) where deleted_at is not null;

alter table public.client_presets enable row level security;
alter table public.work_entry_checklist enable row level security;
alter table public.evidence_integrity enable row level security;
alter table public.work_journal enable row level security;
alter table public.report_view_events enable row level security;
alter table public.focus_sessions enable row level security;

drop policy if exists client_presets_own_all on public.client_presets;
create policy client_presets_own_all on public.client_presets for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists checklist_own_all on public.work_entry_checklist;
create policy checklist_own_all on public.work_entry_checklist for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists evidence_integrity_own_all on public.evidence_integrity;
create policy evidence_integrity_own_all on public.evidence_integrity for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists journal_own_all on public.work_journal;
create policy journal_own_all on public.work_journal for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists report_view_events_owner_select on public.report_view_events;
create policy report_view_events_owner_select on public.report_view_events for select to authenticated using (exists (select 1 from public.finalized_reports r where r.id=report_id and r.user_id=(select auth.uid())));
drop policy if exists focus_sessions_own_all on public.focus_sessions;
create policy focus_sessions_own_all on public.focus_sessions for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

grant select,insert,update,delete on public.client_presets, public.work_entry_checklist, public.evidence_integrity, public.work_journal, public.focus_sessions to authenticated;
grant select on public.report_view_events to authenticated;
revoke all on public.report_view_events from anon;

create or replace function public.soft_delete_work_entry(p_entry_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path=public,private as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  update public.work_entries
  set deleted_at=now(), delete_reason=coalesce(p_reason,'')
  where id=p_entry_id and employee_id=v_uid and status='completed' and locked_at is null and deleted_at is null;
  if not found then raise exception 'Record cannot be moved to Trash'; end if;
end;$$;
grant execute on function public.soft_delete_work_entry(uuid,text) to authenticated;

create or replace function public.restore_work_entry(p_entry_id uuid)
returns void language plpgsql security definer set search_path=public,private as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  update public.work_entries set deleted_at=null, delete_reason='' where id=p_entry_id and employee_id=v_uid and deleted_at is not null;
  if not found then raise exception 'Trash record not found'; end if;
end;$$;
grant execute on function public.restore_work_entry(uuid) to authenticated;

create or replace function public.permanent_delete_work_entry(p_entry_id uuid)
returns void language plpgsql security definer set search_path=public,private as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  delete from public.work_entries where id=p_entry_id and employee_id=v_uid and deleted_at is not null and locked_at is null;
  if not found then raise exception 'Trash record cannot be permanently deleted'; end if;
end;$$;
grant execute on function public.permanent_delete_work_entry(uuid) to authenticated;

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
  insert into public.finalized_reports(user_id,report_code,title,period_start,period_end,entry_ids,snapshot,parent_report_id,version_no,amendment_reason,report_options,status)
  values(v_uid,v_code,coalesce(nullif(trim(p_title),''),v_parent.title),v_parent.period_start,v_parent.period_end,v_parent.entry_ids,p_snapshot,v_root,v_version,coalesce(p_reason,''),coalesce(p_report_options,'{}'::jsonb),'finalized')
  returning * into v_report;
  return v_report;
end;$$;
grant execute on function public.create_report_revision(uuid,text,jsonb,text,jsonb) to authenticated;
