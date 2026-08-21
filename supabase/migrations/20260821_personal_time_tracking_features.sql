alter table public.work_entries
  add column if not exists break_seconds integer not null default 0,
  add column if not exists paused_at timestamptz;

alter table public.work_entries drop constraint if exists work_entries_status_check;
alter table public.work_entries add constraint work_entries_status_check
  check (status in ('active','paused','completed'));

alter table public.work_entries drop constraint if exists work_entries_check;
alter table public.work_entries add constraint work_entries_state_check
  check (
    (status in ('active','paused') and ended_at is null and after_path is null)
    or
    (status = 'completed' and ended_at is not null and after_path is not null)
  );

alter table public.work_entries drop constraint if exists work_entries_break_seconds_check;
alter table public.work_entries add constraint work_entries_break_seconds_check check (break_seconds >= 0);

alter table public.work_entries drop constraint if exists work_entries_pause_state_check;
alter table public.work_entries add constraint work_entries_pause_state_check
  check ((status = 'paused' and paused_at is not null) or (status <> 'paused' and paused_at is null));

drop index if exists public.one_active_entry_per_employee;
create unique index one_open_entry_per_employee on public.work_entries(employee_id) where status in ('active','paused');

create table if not exists public.work_entry_audit (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.work_entries(id) on delete cascade,
  edited_by uuid not null references public.profiles(id) on delete restrict,
  edited_at timestamptz not null default now(),
  old_values jsonb not null,
  new_values jsonb not null
);

create index if not exists work_entry_audit_entry_idx on public.work_entry_audit(entry_id, edited_at desc);
create index if not exists work_entry_audit_editor_idx on public.work_entry_audit(edited_by, edited_at desc);
alter table public.work_entry_audit enable row level security;

drop policy if exists "work_entry_audit_select_owner" on public.work_entry_audit;
create policy "work_entry_audit_select_owner" on public.work_entry_audit
for select to authenticated
using (
  edited_by = (select auth.uid())
  or private.is_system_admin()
  or exists (select 1 from public.work_entries e where e.id = entry_id and e.employee_id = (select auth.uid()))
);

grant select on public.work_entry_audit to authenticated;

create or replace function private.protect_work_entry_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' and not private.is_system_admin() then
    raise exception 'Completed work entries are immutable';
  end if;
  if new.employee_id <> old.employee_id or new.organization_id <> old.organization_id then
    raise exception 'Work entry ownership cannot be changed';
  end if;
  if new.started_at <> old.started_at and not private.is_system_admin() then
    raise exception 'Only the owner administrator may correct a start timestamp';
  end if;
  return new;
end;
$$;

create or replace function private.audit_completed_work_entry_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' and (
    new.title is distinct from old.title
    or new.notes is distinct from old.notes
    or new.started_at is distinct from old.started_at
    or new.ended_at is distinct from old.ended_at
  ) then
    insert into public.work_entry_audit(entry_id, edited_by, old_values, new_values)
    values (
      new.id,
      coalesce((select auth.uid()), new.employee_id),
      jsonb_build_object('title',old.title,'notes',old.notes,'started_at',old.started_at,'ended_at',old.ended_at),
      jsonb_build_object('title',new.title,'notes',new.notes,'started_at',new.started_at,'ended_at',new.ended_at)
    );
  end if;
  return new;
end;
$$;

revoke all on function private.audit_completed_work_entry_edit() from public;
drop trigger if exists audit_completed_work_entry_edit on public.work_entries;
create trigger audit_completed_work_entry_edit after update on public.work_entries for each row execute function private.audit_completed_work_entry_edit();