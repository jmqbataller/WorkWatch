create table if not exists public.work_entry_during_evidence (
  id uuid primary key default gen_random_uuid(),
  work_entry_id uuid not null references public.work_entries(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  path text not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(work_entry_id, path)
);

create index if not exists work_entry_during_evidence_entry_idx
  on public.work_entry_during_evidence(work_entry_id, captured_at asc);
create index if not exists work_entry_during_evidence_user_idx
  on public.work_entry_during_evidence(user_id, captured_at desc);

alter table public.work_entry_during_evidence enable row level security;

drop policy if exists "during_evidence_select_own" on public.work_entry_during_evidence;
create policy "during_evidence_select_own" on public.work_entry_during_evidence
for select to authenticated
using (user_id = (select auth.uid()) or private.is_system_admin());

drop policy if exists "during_evidence_insert_own" on public.work_entry_during_evidence;
create policy "during_evidence_insert_own" on public.work_entry_during_evidence
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.work_entries w
    where w.id = work_entry_id
      and w.employee_id = (select auth.uid())
      and w.status in ('active','paused')
  )
);

drop policy if exists "during_evidence_delete_own" on public.work_entry_during_evidence;
create policy "during_evidence_delete_own" on public.work_entry_during_evidence
for delete to authenticated
using (user_id = (select auth.uid()));

grant select, insert, delete on public.work_entry_during_evidence to authenticated;

insert into public.work_entry_during_evidence (work_entry_id, user_id, path, captured_at)
select id, employee_id, during_path, coalesce(during_at, created_at)
from public.work_entries
where during_path is not null
on conflict (work_entry_id, path) do nothing;
