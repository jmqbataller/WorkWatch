create index if not exists focus_sessions_work_entry_idx on public.focus_sessions(work_entry_id) where work_entry_id is not null;
create index if not exists report_submissions_user_idx on public.report_submissions(user_id, submitted_at desc);
create index if not exists work_entry_checklist_user_idx on public.work_entry_checklist(user_id, created_at desc);
create index if not exists work_journal_related_entry_idx on public.work_journal(related_entry_id) where related_entry_id is not null;
