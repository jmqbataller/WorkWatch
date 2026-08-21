-- WorkWatch: multi-tenant VA / employer time tracking schema
-- Run this in a NEW Supabase project's SQL Editor.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default 'New User',
  role text not null default 'employee' check (role in ('system_admin','employer','employee')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_type text not null check (member_type in ('employer','employee')),
  created_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.work_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 500),
  status text not null default 'active' check (status in ('active','completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  before_path text not null,
  after_path text,
  created_at timestamptz not null default now(),
  check ((status = 'active' and ended_at is null and after_path is null) or (status = 'completed' and ended_at is not null and after_path is not null)),
  check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists one_active_entry_per_employee on public.work_entries(employee_id) where status = 'active';
create index if not exists work_entries_org_started_idx on public.work_entries(organization_id, started_at desc);
create index if not exists work_entries_employee_started_idx on public.work_entries(employee_id, started_at desc);
create index if not exists organization_members_org_idx on public.organization_members(organization_id);

create or replace function private.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists(
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'system_admin' and p.status = 'active'
  ), false);
$$;

create or replace function private.user_in_org(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists(
    select 1 from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and p.status = 'active'
  ), false);
$$;

create or replace function private.is_org_employer(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_system_admin() or coalesce(exists(
    select 1 from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.member_type = 'employer'
      and p.role = 'employer'
      and p.status = 'active'
  ), false);
$$;

create or replace function private.can_view_user(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user = (select auth.uid())
    or private.is_system_admin()
    or coalesce(exists(
      select 1
      from public.organization_members me
      join public.organization_members them on them.organization_id = me.organization_id
      join public.profiles p on p.id = me.user_id
      where me.user_id = (select auth.uid())
        and me.member_type = 'employer'
        and p.role = 'employer'
        and p.status = 'active'
        and them.user_id = target_user
    ), false);
$$;

grant execute on function private.is_system_admin() to authenticated;
grant execute on function private.user_in_org(uuid) to authenticated;
grant execute on function private.is_org_employer(uuid) to authenticated;
grant execute on function private.can_view_user(uuid) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email,'New User'), '@', 1)),
    'employee'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

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
  if new.employee_id <> old.employee_id or new.organization_id <> old.organization_id or new.started_at <> old.started_at then
    raise exception 'Work entry ownership and start timestamp cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_work_entry_history() from public;

drop trigger if exists protect_work_entry_history on public.work_entries;
create trigger protect_work_entry_history
before update on public.work_entries
for each row execute function private.protect_work_entry_history();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.work_entries enable row level security;

drop policy if exists "profiles_select_authorized" on public.profiles;
create policy "profiles_select_authorized" on public.profiles
for select to authenticated
using (private.can_view_user(id));

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
for update to authenticated
using (private.is_system_admin())
with check (private.is_system_admin());

drop policy if exists "organizations_select_authorized" on public.organizations;
create policy "organizations_select_authorized" on public.organizations
for select to authenticated
using (private.is_system_admin() or private.user_in_org(id));

drop policy if exists "organizations_admin_insert" on public.organizations;
create policy "organizations_admin_insert" on public.organizations
for insert to authenticated
with check (private.is_system_admin());

drop policy if exists "organizations_admin_update" on public.organizations;
create policy "organizations_admin_update" on public.organizations
for update to authenticated
using (private.is_system_admin())
with check (private.is_system_admin());

drop policy if exists "organizations_admin_delete" on public.organizations;
create policy "organizations_admin_delete" on public.organizations
for delete to authenticated
using (private.is_system_admin());

drop policy if exists "memberships_select_authorized" on public.organization_members;
create policy "memberships_select_authorized" on public.organization_members
for select to authenticated
using (user_id = (select auth.uid()) or private.is_system_admin() or private.is_org_employer(organization_id));

drop policy if exists "memberships_admin_insert" on public.organization_members;
create policy "memberships_admin_insert" on public.organization_members
for insert to authenticated
with check (private.is_system_admin());

drop policy if exists "memberships_admin_update" on public.organization_members;
create policy "memberships_admin_update" on public.organization_members
for update to authenticated
using (private.is_system_admin())
with check (private.is_system_admin());

drop policy if exists "memberships_admin_delete" on public.organization_members;
create policy "memberships_admin_delete" on public.organization_members
for delete to authenticated
using (private.is_system_admin());

drop policy if exists "work_entries_select_authorized" on public.work_entries;
create policy "work_entries_select_authorized" on public.work_entries
for select to authenticated
using (employee_id = (select auth.uid()) or private.is_system_admin() or private.is_org_employer(organization_id));

drop policy if exists "work_entries_employee_insert" on public.work_entries;
create policy "work_entries_employee_insert" on public.work_entries
for insert to authenticated
with check (
  employee_id = (select auth.uid())
  and private.user_in_org(organization_id)
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'employee' and p.status = 'active')
);

drop policy if exists "work_entries_employee_update" on public.work_entries;
create policy "work_entries_employee_update" on public.work_entries
for update to authenticated
using (employee_id = (select auth.uid()))
with check (employee_id = (select auth.uid()) and private.user_in_org(organization_id));

grant select on public.profiles, public.organizations, public.organization_members, public.work_entries to authenticated;
grant insert, update on public.work_entries to authenticated;
grant insert, update, delete on public.organizations, public.organization_members to authenticated;
grant update on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence','evidence',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "evidence_insert_own_folder" on storage.objects;
create policy "evidence_insert_own_folder" on storage.objects
for insert to authenticated
with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "evidence_select_authorized" on storage.objects;
create policy "evidence_select_authorized" on storage.objects
for select to authenticated
using (
  bucket_id = 'evidence'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or private.is_system_admin()
    or private.can_view_user(((storage.foldername(name))[1])::uuid)
  )
);

drop policy if exists "evidence_update_own_folder" on storage.objects;
create policy "evidence_update_own_folder" on storage.objects
for update to authenticated
using (bucket_id = 'evidence' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = (select auth.uid())::text);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_entries'
  ) then
    alter publication supabase_realtime add table public.work_entries;
  end if;
end $$;

-- After creating your first account, promote it once in the SQL Editor:
-- update public.profiles set role = 'system_admin' where email = 'YOUR_ADMIN_EMAIL';
