# Localscope — Setup & first-run guide

How to take this repo from "built" to "working in Lovable Cloud". Everything
below can be done without a local database or CLI — just the Supabase
Dashboard and the Lovable preview.

## What you need before starting

| Item | Status | Where it lives |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Set as an encrypted secret | Lovable: More → Cloud → Secrets |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-managed (reserved prefix) | Lovable: More → Cloud → Secrets (marked "Lovable") |
| `LOVABLE_API_KEY` | Auto-managed (reserved prefix) | Lovable: More → Cloud → Secrets (marked "Lovable") |
| `LOVABLE_CRON_SECRET` | Needed only for the weekly run | Lovable: More → Cloud → Secrets |

Private keys always go in **Secrets**, never in `.env`. The committed
`.env` holds only public `VITE_*` values and must stay committed —
gitignoring it breaks Lovable previews.

## Step 1 — Apply the migrations

Open **Supabase Dashboard → SQL Editor** (new query) and run the blocks below
**in order**. Run block 0 only if the waitlist form has never worked (it errors
with "relation already exists" if already applied — safe to skip).

Check what already exists first (run this, then decide):

```sql
select to_regclass('public.waitlist_signups')      as waitlist,
       to_regclass('public.profiles')              as profiles,
       to_regclass('public.briefs')                as briefs,
       to_regclass('public.monitoring_snapshots')  as snapshots;
-- NULL in a column = that table is missing; run the matching block below.
```

### Block 0 — waitlist (template table; skip if it already exists)

```sql
CREATE TABLE public.waitlist_signups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  business_name TEXT,
  city TEXT,
  business_type TEXT NOT NULL DEFAULT 'salon',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT ALL ON public.waitlist_signups TO service_role;
ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;
```

### Block 1 — profiles + briefs

```sql
-- Profiles for authenticated users, and briefs generated for them.
-- Dashboard reads/writes flow through RLS with the user's JWT
-- (the user-scoped client from requireSupabaseAuth), so no service-role
-- key is needed for these tables.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  business_type text not null default 'salon' check (business_type in ('salon', 'spa', 'other')),
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  business_type text not null default 'salon' check (business_type in ('salon', 'spa', 'other')),
  location text not null,
  brief jsonb not null,
  created_at timestamptz not null default now()
);

create index briefs_user_created_idx on public.briefs (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.briefs enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id);

create policy "briefs_select_own" on public.briefs
  for select using ((select auth.uid()) = user_id);
create policy "briefs_insert_own" on public.briefs
  for insert with check ((select auth.uid()) = user_id);

grant all on public.profiles to service_role;
grant all on public.profiles to authenticated;
grant all on public.briefs to service_role;
grant all on public.briefs to authenticated;
```

### Block 2 — monitoring history

```sql
-- Append-only per-user history of research runs. Each run stores the full
-- research snapshot plus the changes detected against the previous run, so
-- briefs can be written from real deltas ("price cut from £45 to £40")
-- instead of a fresh one-shot look.

create table public.monitoring_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  business_type text not null default 'salon' check (business_type in ('salon', 'spa', 'other')),
  location text not null,
  snapshot jsonb not null,
  detected_changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index monitoring_snapshots_user_created_idx
  on public.monitoring_snapshots (user_id, created_at desc);

alter table public.monitoring_snapshots enable row level security;

create policy "monitoring_snapshots_select_own" on public.monitoring_snapshots
  for select using ((select auth.uid()) = user_id);
create policy "monitoring_snapshots_insert_own" on public.monitoring_snapshots
  for insert with check ((select auth.uid()) = user_id);

grant all on public.monitoring_snapshots to service_role;
grant all on public.monitoring_snapshots to authenticated;
```

### Block 3 — email flag + waitlist → account link

```sql
-- Idempotent weekly email delivery: mark each brief after its email is sent
-- so scheduled retries never double-send.
alter table public.briefs add column emailed_at timestamptz;

-- Link waitlist signups to authenticated accounts when a user signs up with
-- the same email, so waitlist data can prefill their dashboard profile.
alter table public.waitlist_signups add column user_id uuid references auth.users(id) on delete set null;
create index waitlist_signups_user_id_idx on public.waitlist_signups (user_id);
```

### Block 4 — optional "your price" column (skip = app degrades gracefully)

```sql
-- Unlocks price-position analysis ("you are the 3rd cheapest of 9 publishing
-- prices"). If skipped, everything else still works — saves simply omit the
-- column and the dashboard shows a nudge instead of a price rank.
alter table public.profiles add column if not exists price_point text;
```

Sanity check (all four must return table names, not NULL):

```sql
select to_regclass('public.waitlist_signups'),
       to_regclass('public.profiles'),
       to_regclass('public.briefs'),
       to_regclass('public.monitoring_snapshots');
```

## Step 2 — First run in the Lovable preview (10 minutes)

1. Open the app preview → **Log in** → **Create your account** (email + password).
2. **Save profile** — business name, type, location. (Fails with "Could not save
   your profile" only if Block 1 hasn't been applied.)
3. **Run scan now** — the first scan only establishes the baseline; the
   "What changed" panel explains that nothing is reported yet.
4. Wait a few minutes (or a day) and **Run scan now** again — real detected
   changes (price moves, hours, ratings, new entrants) now appear in the panel
   and the brief is written from those deltas.
5. Sign out → log in again; your briefs are listed under **Past briefs**.

Optional: join the waitlist with the same email you used to sign up, then check
the dashboard pre-fills from your waitlist row (waitlist → account claim).

## Step 3 — Weekly automation (when you're ready)

Email delivery is currently **on hold** (see `TODO.md`). The plumbing exists:
the cron endpoint runs the full monitoring cycle for every saved profile and
reports `processed` / `emailed` / `failed` as JSON. To activate:

1. Add `LOVABLE_CRON_SECRET` in Lovable Secrets.
2. Trigger once to test: POST `/api/cron/run-monitoring` with header
   `Authorization: Bearer $LOVABLE_CRON_SECRET`.
3. Configure your scheduler (e.g. Monday 08:00) to hit that endpoint.

## Troubleshooting

- **"Could not save your profile"** → `profiles` table missing; run Block 1.
- **"Missing Supabase environment variable"** in server logs → the reserved
  `SUPABASE_*` / `LOVABLE_*` secrets are absent; check More → Cloud →
  Secrets in Lovable.
- **Demo brief has no prices** → `GOOGLE_PLACES_API_KEY` not set in Secrets;
  without it the engine falls back to OpenStreetMap-only data.
- **Generator says "try again in a few minutes"** → the per-IP rate limit
  (3 briefs / 15 min) is shared with the dashboard's scan button by design.
