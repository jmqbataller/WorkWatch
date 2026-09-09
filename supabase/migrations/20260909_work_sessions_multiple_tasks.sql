-- WorkWatch: work-session-first timing + multiple overlapping tasks

create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  status text not null default 'active' check (status in ('active','paused','completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  break_seconds integer not null default 0 check (break_seconds >= 0),
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'completed' and ended_at is not null and paused_at is null) or (status in ('active','paused') and ended_at is null)),
  check ((status = 'paused' and paused_at is not null) or (status <> 'paused' and paused_at is null)),
  check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists one_open_work_session_per_user
  on public.work_sessions(user_id) where status in ('active','paused');
create index if not exists work_sessions_user_started_idx on public.work_sessions(user_id, started_at desc);
create index if not exists work_sessions_org_started_idx on public.work_sessions(organization_id, started_at desc);

alter table public.work_sessions enable row level security;

drop policy if exists "work_sessions_select_own" on public.work_sessions;
create policy "work_sessions_select_own" on public.work_sessions
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "work_sessions_insert_own" on public.work_sessions;
create policy "work_sessions_insert_own" on public.work_sessions
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "work_sessions_update_own" on public.work_sessions;
create policy "work_sessions_update_own" on public.work_sessions
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update on public.work_sessions to authenticated;

alter table public.work_entries
  add column if not exists work_session_id uuid references public.work_sessions(id) on delete set null;
create index if not exists work_entries_session_idx on public.work_entries(work_session_id, started_at);

-- A work session is now the single source of actual worked time.
-- Multiple tasks may be open simultaneously inside the same session.
drop index if exists public.one_active_entry_per_employee;
drop index if exists public.one_open_entry_per_employee;

-- Realtime is optional for the personal UI, but keeps session state current across tabs/devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_sessions'
  ) then
    alter publication supabase_realtime add table public.work_sessions;
  end if;
end $$;
