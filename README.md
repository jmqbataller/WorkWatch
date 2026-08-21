# WorkWatch

WorkWatch is a multi-tenant workforce time-tracking web app for virtual assistants, employees, employers, and system administrators.

## Roles

- **Employee / VA** — starts a task with a required before screenshot, tracks live elapsed time, finishes with an after screenshot, reviews history, and exports reports.
- **Employer** — sees employees in the same organization, live working/idle status, current tasks, tracked time, completed tasks, and screenshot evidence.
- **System Admin** — creates organizations, manages account roles, and assigns employers/employees to organizations.

## Stack

- HTML/CSS/JavaScript frontend
- Supabase Auth, Postgres, Storage, Realtime, and RLS
- Vercel static hosting + `/api/config` serverless runtime configuration
- GitHub source control

## Supabase setup

1. Create a new Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor.
3. Create your first account through WorkWatch.
4. Promote that account once in SQL Editor:

```sql
update public.profiles
set role = 'system_admin'
where email = 'YOUR_ADMIN_EMAIL';
```

5. Add these Vercel environment variables:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is intentionally used in the browser. Authorization is enforced by Supabase Row Level Security. Never expose a `service_role`/secret key to the frontend.

## Local preview

Without Supabase environment variables, the app opens in demo mode so all three role dashboards can be previewed.

## Security model

- Employees can read/write their own work entries only.
- Employers can read employees and work entries in their organization only.
- System admins can manage organizations and user assignments.
- Evidence screenshots are stored in a private Supabase Storage bucket and accessed via signed URLs.
- Completed time entries are immutable to non-admin users.
