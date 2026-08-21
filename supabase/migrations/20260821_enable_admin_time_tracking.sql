drop policy if exists "work_entries_employee_insert" on public.work_entries;
create policy "work_entries_own_insert" on public.work_entries
for insert to authenticated
with check (
  employee_id = (select auth.uid())
  and (
    private.is_system_admin()
    or (
      private.user_in_org(organization_id)
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.role = 'employee'
          and p.status = 'active'
      )
    )
  )
);

drop policy if exists "work_entries_employee_update" on public.work_entries;
create policy "work_entries_own_update" on public.work_entries
for update to authenticated
using (
  employee_id = (select auth.uid())
  and (
    private.is_system_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'employee'
        and p.status = 'active'
    )
  )
)
with check (
  employee_id = (select auth.uid())
  and (
    private.is_system_admin()
    or (
      private.user_in_org(organization_id)
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.role = 'employee'
          and p.status = 'active'
      )
    )
  )
);
