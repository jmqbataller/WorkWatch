-- JM WorkLog invoice generator, payment tracking, and private receipt storage.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  invoice_number text not null default (
    'INV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  ),
  client_name text not null check (char_length(trim(client_name)) between 1 and 160),
  client_email text not null default '' check (char_length(client_email) <= 254),
  currency text not null default 'USD' check (currency = 'USD'),
  hourly_rate numeric(12,2) not null check (hourly_rate > 0),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  status text not null default 'not_paid' check (status in ('not_paid', 'pending', 'paid')),
  issued_on date not null default current_date,
  due_on date,
  paid_at timestamptz,
  receipt_path text,
  notes text not null default '' check (char_length(notes) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, invoice_number),
  check (due_on is null or due_on >= issued_on),
  check (status <> 'paid' or paid_at is not null),
  check (receipt_path is null or status = 'paid')
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_entry_id uuid references public.work_entries(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  client_label text not null default '',
  project_label text not null default '',
  started_at timestamptz not null,
  ended_at timestamptz not null,
  break_seconds integer not null default 0 check (break_seconds >= 0),
  recorded_seconds integer not null check (recorded_seconds >= 0),
  hourly_rate numeric(12,2) not null check (hourly_rate > 0),
  line_amount numeric(14,2) not null check (line_amount >= 0),
  created_at timestamptz not null default now(),
  unique (invoice_id, work_entry_id)
);

create index if not exists invoices_user_status_paid_idx
  on public.invoices(user_id, status, paid_at desc);
create index if not exists invoices_user_created_idx
  on public.invoices(user_id, created_at desc);
create index if not exists invoice_items_invoice_idx
  on public.invoice_items(invoice_id, created_at);
create index if not exists invoice_items_user_idx
  on public.invoice_items(user_id, created_at desc);
create index if not exists invoice_items_work_entry_idx
  on public.invoice_items(work_entry_id) where work_entry_id is not null;

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists invoices_own_select on public.invoices;
create policy invoices_own_select on public.invoices
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists invoices_own_insert on public.invoices;
create policy invoices_own_insert on public.invoices
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists invoices_own_update on public.invoices;
create policy invoices_own_update on public.invoices
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists invoices_own_delete on public.invoices;
create policy invoices_own_delete on public.invoices
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists invoice_items_own_select on public.invoice_items;
create policy invoice_items_own_select on public.invoice_items
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists invoice_items_own_insert on public.invoice_items;
create policy invoice_items_own_insert on public.invoice_items
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id
      and invoice.user_id = (select auth.uid())
  )
);

drop policy if exists invoice_items_own_delete on public.invoice_items;
create policy invoice_items_own_delete on public.invoice_items
for delete to authenticated
using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, delete on public.invoice_items to authenticated;
revoke all on public.invoices, public.invoice_items from anon;

create or replace function public.create_personal_invoice(
  p_client_name text,
  p_client_email text,
  p_due_on date,
  p_notes text,
  p_hourly_rate numeric,
  p_entry_ids uuid[]
)
returns public.invoices
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invoice public.invoices;
  v_owned_count integer;
  v_total numeric(14,2);
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if nullif(trim(coalesce(p_client_name, '')), '') is null then
    raise exception 'Client name is required';
  end if;
  if p_hourly_rate is null or p_hourly_rate <= 0 or p_hourly_rate > 1000000 then
    raise exception 'Hourly rate must be greater than zero';
  end if;
  if p_entry_ids is null or cardinality(p_entry_ids) = 0 then
    raise exception 'Select at least one completed task';
  end if;
  if cardinality(p_entry_ids) <> cardinality(array(select distinct unnest(p_entry_ids))) then
    raise exception 'Duplicate tasks are not allowed';
  end if;

  select count(*) into v_owned_count
  from public.work_entries entry
  where entry.id = any(p_entry_ids)
    and entry.employee_id = v_uid
    and entry.status = 'completed'
    and entry.ended_at is not null
    and entry.deleted_at is null;

  if v_owned_count <> cardinality(p_entry_ids) then
    raise exception 'All selected tasks must be your completed work records';
  end if;

  if exists (
    select 1 from public.invoice_items item
    where item.user_id = v_uid and item.work_entry_id = any(p_entry_ids)
  ) then
    raise exception 'One or more selected tasks are already included in an invoice';
  end if;

  insert into public.invoices (
    user_id, client_name, client_email, hourly_rate, due_on, notes
  ) values (
    v_uid,
    trim(p_client_name),
    left(trim(coalesce(p_client_email, '')), 254),
    round(p_hourly_rate, 2),
    p_due_on,
    left(coalesce(p_notes, ''), 3000)
  ) returning * into v_invoice;

  insert into public.invoice_items (
    invoice_id, user_id, work_entry_id, title, description,
    client_label, project_label, started_at, ended_at,
    break_seconds, recorded_seconds, hourly_rate, line_amount
  )
  select
    v_invoice.id,
    v_uid,
    entry.id,
    left(entry.title, 160),
    entry.notes,
    entry.client_label,
    entry.project_label,
    entry.started_at,
    entry.ended_at,
    greatest(0, entry.break_seconds),
    greatest(0, floor(extract(epoch from (entry.ended_at - entry.started_at)))::integer - greatest(0, entry.break_seconds)),
    round(p_hourly_rate, 2),
    round(
      greatest(0, extract(epoch from (entry.ended_at - entry.started_at)) - greatest(0, entry.break_seconds))
      / 3600.0 * round(p_hourly_rate, 2),
      2
    )
  from public.work_entries entry
  where entry.id = any(p_entry_ids);

  select coalesce(sum(item.line_amount), 0)
  into v_total
  from public.invoice_items item
  where item.invoice_id = v_invoice.id and item.user_id = v_uid;

  update public.invoices
  set subtotal = v_total, total_amount = v_total, updated_at = now()
  where id = v_invoice.id and user_id = v_uid
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function public.create_personal_invoice(text,text,date,text,numeric,uuid[]) from public;
revoke all on function public.create_personal_invoice(text,text,date,text,numeric,uuid[]) from anon;
grant execute on function public.create_personal_invoice(text,text,date,text,numeric,uuid[]) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts',
  'payment-receipts',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists payment_receipts_select_own on storage.objects;
create policy payment_receipts_select_own on storage.objects
for select to authenticated
using (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists payment_receipts_insert_own on storage.objects;
create policy payment_receipts_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.invoices invoice
    where invoice.id::text = (storage.foldername(name))[2]
      and invoice.user_id = (select auth.uid())
      and invoice.status = 'paid'
  )
);

drop policy if exists payment_receipts_update_own on storage.objects;
create policy payment_receipts_update_own on storage.objects
for update to authenticated
using (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.invoices invoice
    where invoice.id::text = (storage.foldername(name))[2]
      and invoice.user_id = (select auth.uid())
      and invoice.status = 'paid'
  )
);

drop policy if exists payment_receipts_delete_own on storage.objects;
create policy payment_receipts_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
