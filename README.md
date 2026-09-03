# JM WorkLog

JM WorkLog is a personal task, time, and work-evidence tracker for keeping clean work records and creating client-ready reports.

## Personal workflow

- Start a task with a required before screenshot.
- Track recorded work time with break time excluded.
- Add optional during-work evidence and task checklist items.
- Finish a task with an after screenshot.
- Review work history, daily records, and evidence.
- Build custom exports from one task, a full day, or any selected combination of tasks.
- Export client-ready PDF and CSV records.

## Stack

- HTML/CSS/JavaScript frontend
- Supabase Auth, Postgres, Storage, Realtime, and RLS
- Vercel static hosting + `/api/config` serverless runtime configuration
- GitHub source control

## Supabase setup

1. Create a Supabase project.
2. Run the required migrations in the SQL Editor.
3. Create your account.
4. Promote the personal account once in SQL Editor:

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

The publishable key is intentionally used in the browser. Authorization is enforced by Supabase Row Level Security. Never expose a `service_role` or secret key to the frontend.

## Security model

- Personal work records are account-scoped.
- Evidence screenshots are stored in a private Supabase Storage bucket and accessed through signed URLs.
- Finalized reports can lock selected records to preserve report integrity.
- Existing internal database role names are retained for compatibility with the current schema.
