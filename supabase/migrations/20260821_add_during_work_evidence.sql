alter table public.work_entries
  add column if not exists during_path text,
  add column if not exists during_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_entries_during_pair_check') then
    alter table public.work_entries add constraint work_entries_during_pair_check
      check ((during_path is null and during_at is null) or (during_path is not null and during_at is not null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'work_entries_during_time_check') then
    alter table public.work_entries add constraint work_entries_during_time_check
      check (during_at is null or (during_at >= started_at and (ended_at is null or during_at <= ended_at)));
  end if;
end $$;
