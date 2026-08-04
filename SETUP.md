# Setup Guide — from demo mode to live

The app works immediately in **demo mode** (open it, password `bingo`) with data stored in the
browser. These are the steps to make it live on Supabase. Total time: about an hour. Do them
in order; each is safe to stop after.

## 1. Supabase project (~15 min)

1. Create an account at supabase.com **in the business's name** → New project, call it `bingo-inventory`, pick a strong database password (save it), region: West US.
2. In the SQL Editor, run the three files from `supabase/migrations/` in order:
   `001_schema.sql`, then `002_audit_rls.sql`, then `003_seed.sql`.
   Each should end with "Success". After 003, Table Editor → products should show 348 rows.
3. Storage → New bucket named `invoices` (private).
4. Authentication → Users → Add user: one email + strong password. This is the login both hall PCs share.
5. Project Settings → API: copy the **Project URL** and the **anon public** key.

## 2. Point the app at Supabase (~5 min)

1. In the project folder, copy `.env.example` to `.env` and paste the URL and anon key.
2. Rebuild/redeploy (step 5). That's the entire switch — the app detects the keys and demo mode turns off.

## 3. Email — Resend account (~15 min)

1. Create an account at resend.com (business name). Free tier = 100 emails/day, plenty.
2. Verify your sending domain if you have one (Settings → Domains) so POs come from
   `orders@yourdomain.com`. Without a domain, Resend's shared address works but looks less professional.
3. Copy the API key. In a terminal with the Supabase CLI (`npm i -g supabase`, `supabase login`):
   ```
   supabase link --project-ref <your-project-ref>
   supabase secrets set RESEND_API_KEY=<key>
   supabase functions deploy send-email
   supabase functions deploy weekly-export
   ```
4. In the app: Settings → set the FROM address, the accounting address, and **leave Test mode ON**
   with your own email as the test inbox. Every email goes only to you until you flip it off.

## 4. AI invoice reading (~10 min)

1. Get an Anthropic API key (console.anthropic.com — business account).
2. ```
   supabase secrets set ANTHROPIC_API_KEY=<key>
   supabase functions deploy read-invoice
   ```
3. Cost is pennies per invoice photo.

## 5. Host the app (~10 min)

1. Create a free account at netlify.com or vercel.com.
2. Deploy the project (drag-and-drop the `dist/` folder after `npm run build`, or connect the repo).
   Add the two `.env` values as environment variables in the host's settings.
3. Bookmark the **role links** on each machine (see README "Roles"):
   SC hall PC → `https://yourapp.com/?role=sc` · RWC hall PC → `/?role=rwc` ·
   accounting → `/?role=accountant` · you → `/?role=admin`.
   Everyone signs in with the shared user from step 1.4. Add `&demo` to any link to open the
   staged sandbox for training — it never touches real data.

## 6. Weekly export schedule (~5 min)

In Supabase SQL Editor (fill in your project URL + service key from Project Settings → API):
```sql
select cron.schedule('weekly-export', '0 15 * * 1',
  $$ select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/weekly-export',
       headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb ) $$);
```
(If `cron` or `net` is missing: Database → Extensions → enable `pg_cron` and `pg_net`.)

## 7. Go-live sequence (the plan's Phase 5)

1. Change the admin PIN from the default **1234** (Settings → Admin PIN) — do this first.
2. Enter vendor PO email addresses and hall delivery addresses in Settings.
3. Physical count day at SC → enter opening inventory (Receiving → or ask me to build a
   bulk-count import from a spreadsheet — quick addition).
4. Run one full order cycle with **Test mode ON** — all 8 emails come to you.
5. When a cycle matches the spreadsheet: turn Test mode OFF. SC is live.
6. Repeat count day at RWC; its PC uses the same URL with the hall switcher set to Redwood City.

## Troubleshooting

- **App stuck in demo mode after adding .env** → the values must be present at build time; rebuild/redeploy.
- **Emails "failed" in the log** → open the email row in Supabase → the send-email function logs the reason (missing key, unverified domain, no recipient).
- **"illegal box state transition"** → the database refused an impossible move (e.g. selling a box that was never opened). This is protection working, not a bug — check the box's serial.
- **Restore practice** (do once before go-live): Supabase Dashboard → Database → Backups → restore to a new project, confirm tables are intact, delete the copy.
