-- Allow queued During evidence to sync after a task has just been completed,
-- while still restricting evidence to the authenticated owner's work entries.
drop policy if exists during_evidence_insert_own on public.work_entry_during_evidence;
create policy during_evidence_insert_own on public.work_entry_during_evidence
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.work_entries w
    where w.id = work_entry_id
      and w.employee_id = (select auth.uid())
      and w.deleted_at is null
  )
);
