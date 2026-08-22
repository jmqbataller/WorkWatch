-- Harden WorkWatch owner-scoped SECURITY DEFINER RPCs.
revoke all on function public.finalize_personal_report(text,date,date,uuid[],jsonb) from public;
revoke all on function public.finalize_personal_report(text,date,date,uuid[],jsonb) from anon;
grant execute on function public.finalize_personal_report(text,date,date,uuid[],jsonb) to authenticated;

revoke all on function public.create_report_revision(uuid,text,jsonb,text,jsonb) from public;
revoke all on function public.create_report_revision(uuid,text,jsonb,text,jsonb) from anon;
grant execute on function public.create_report_revision(uuid,text,jsonb,text,jsonb) to authenticated;

revoke all on function public.soft_delete_work_entry(uuid,text) from public;
revoke all on function public.soft_delete_work_entry(uuid,text) from anon;
grant execute on function public.soft_delete_work_entry(uuid,text) to authenticated;

revoke all on function public.restore_work_entry(uuid) from public;
revoke all on function public.restore_work_entry(uuid) from anon;
grant execute on function public.restore_work_entry(uuid) to authenticated;

revoke all on function public.permanent_delete_work_entry(uuid) from public;
revoke all on function public.permanent_delete_work_entry(uuid) from anon;
grant execute on function public.permanent_delete_work_entry(uuid) to authenticated;
