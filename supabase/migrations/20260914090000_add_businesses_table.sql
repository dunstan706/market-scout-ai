-- Multi-business persistence.
--
-- Until now the "businesses" the dashboards showed were a facade over the
-- profiles row (one per account). This migration adds a real businesses
-- table and seeds it from every profile that has a business saved, so
-- existing accounts keep working with zero data entry.
--
-- Tier caps (free = 0 new, watch = 1, advise = 5, expand = unlimited) are
-- enforced server-side in createBusiness — never by constraint — so raising
-- a cap is a code change, not a migration.
--
-- monitoring_snapshots / briefs keep their existing columns untouched;
-- nullable business_id columns are added so historical rows stay valid and
-- the weekly cron (which still iterates profiles) keeps working unchanged.

-- ── 1. The table ─────────────────────────────────────────────────────────────

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_name text not null,
  business_type text not null default 'salon'
    check (business_type in ('salon', 'spa', 'other')),
  location text not null,
  price_point text,
  google_place_id text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists businesses_user_idx on public.businesses (user_id, created_at);

-- ── 2. Seed from existing profiles (idempotent) ─────────────────────────────
-- Every account that already saved a business gets one row. The profile row
-- stays in place as the account-level fallback (billing state, etc.).
--
-- google_place_id is copied so own-listing lookups keep pinning to the same
-- matched listing without a re-match.

insert into public.businesses
  (user_id, business_name, business_type, location, price_point, google_place_id, is_primary)
select
  p.id,
  p.business_name,
  coalesce(p.business_type, 'salon'),
  p.location,
  p.price_point,
  p.google_place_id,
  true
from public.profiles p
where p.business_name is not null
  and p.location is not null
  and not exists (
    select 1 from public.businesses b where b.user_id = p.id
  );

-- ── 3. RLS ───────────────────────────────────────────────────────────────────

alter table public.businesses enable row level security;

drop policy if exists "businesses_select_own" on public.businesses;
create policy "businesses_select_own" on public.businesses
  for select using (auth.uid() = user_id);

drop policy if exists "businesses_insert_own" on public.businesses;
create policy "businesses_insert_own" on public.businesses
  for insert with check (auth.uid() = user_id);

drop policy if exists "businesses_update_own" on public.businesses;
create policy "businesses_update_own" on public.businesses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "businesses_delete_own" on public.businesses;
create policy "businesses_delete_own" on public.businesses
  for delete using (auth.uid() = user_id);

grant all on public.businesses to service_role;
grant select, insert, update, delete on public.businesses to authenticated;

-- ── 4. Per-business history (nullable — history stays readable) ─────────────

alter table public.monitoring_snapshots
  add column if not exists business_id uuid references public.businesses (id) on delete cascade;
create index if not exists monitoring_snapshots_business_idx
  on public.monitoring_snapshots (business_id, created_at desc);

alter table public.briefs
  add column if not exists business_id uuid references public.businesses (id) on delete cascade;
create index if not exists briefs_business_idx
  on public.briefs (business_id, created_at desc);

-- ── 5. Backfill history onto the seeded business (one-time) ─────────────────
-- Snapshots and briefs taken before this migration all belong to the account's
-- single (seeded) business. Matching on business_name keeps them visible in
-- per-business views instead of orphaned with a NULL business_id.

update public.monitoring_snapshots s
set business_id = b.id
from public.businesses b
where b.user_id = s.user_id
  and b.business_name = s.business_name
  and s.business_id is null;

update public.briefs s
set business_id = b.id
from public.businesses b
where b.user_id = s.user_id
  and b.business_name = s.business_name
  and s.business_id is null;
