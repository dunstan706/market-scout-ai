-- Market workspace: competitor profiles, tracked sources, alert rules,
-- location-level market events, and draftable briefs.
--
-- Design notes:
-- - Every table is scoped by user_id AND business_id (a workspace = one
--   business location); RLS enforces ownership like businesses/briefs do.
-- - competitor_facts is the merged-record store: manual entries, scan-derived
--   values, and explicit "unavailable/unknown" states all live here, each row
--   carrying its own source attribution. Nothing is guessed — a field either
--   has a value with a source, or an explicit unknown/unavailable status.
-- - briefs.status: existing rows were all published; the default keeps them
--   valid. Workspace drafts insert status='draft' until reviewed/published.
-- - Tier caps are enforced in code, never by constraint (same policy as
--   businesses).

-- ── competitors ──────────────────────────────────────────────────────────────

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  category text,
  area text,
  website_url text,
  google_place_id text,
  notes text,
  status text not null default 'open' check (status in ('open', 'closed', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists competitors_workspace_idx on public.competitors (business_id, created_at);
create unique index if not exists competitors_name_key
  on public.competitors (business_id, lower(name));

-- ── competitor_facts ─────────────────────────────────────────────────────────
-- One row per (competitor, field). status: 'reported' (value + source),
-- 'unknown' (not known — never guessed), 'unavailable' (confirmed not
-- published by the competitor). needs_review flags stale/conflicting data.

create table if not exists public.competitor_facts (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  field text not null check (field in
    ('price_signal', 'promotion', 'rating', 'hours', 'social_activity', 'openings', 'other')),
  value text,
  status text not null default 'reported' check (status in ('reported', 'unknown', 'unavailable')),
  source_url text,
  source_label text,
  effective_date date,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists competitor_facts_field_key
  on public.competitor_facts (competitor_id, field);
create index if not exists competitor_facts_review_idx
  on public.competitor_facts (business_id, needs_review) where needs_review;

-- ── tracked_sources ──────────────────────────────────────────────────────────

create table if not exists public.tracked_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  competitor_id uuid references public.competitors (id) on delete set null,
  label text not null,
  url text not null,
  kind text not null default 'website'
    check (kind in ('website', 'directory', 'reviews', 'news', 'social')),
  status text not null default 'active' check (status in ('active', 'unreachable', 'needs_review')),
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tracked_sources_url_key on public.tracked_sources (business_id, url);
create index if not exists tracked_sources_workspace_idx on public.tracked_sources (business_id, status);

-- ── alert_rules ──────────────────────────────────────────────────────────────

create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  rule_kind text not null check (rule_kind in
    ('rating_decline', 'price_change', 'new_opening', 'promotion_change')),
  threshold jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists alert_rules_kind_key on public.alert_rules (business_id, rule_kind);

-- ── competitor_events (the neighbourhood change feed) ────────────────────────

create table if not exists public.competitor_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  competitor_id uuid references public.competitors (id) on delete set null,
  event_kind text not null check (event_kind in
    ('new_opening', 'closing', 'development', 'price_change', 'promotion_change', 'note')),
  title text not null,
  detail text,
  source_url text,
  source_label text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists competitor_events_feed_idx on public.competitor_events (business_id, occurred_at desc);

-- ── briefs: draft/publish lifecycle ─────────────────────────────────────────

alter table public.briefs add column if not exists status text not null default 'published';
alter table public.briefs drop constraint if exists briefs_status_check;
alter table public.briefs add constraint briefs_status_check check (status in ('draft', 'published'));
alter table public.briefs add column if not exists week_start date;
create index if not exists briefs_workspace_idx on public.briefs (business_id, created_at desc);

-- ── RLS (owner-only, matching the existing convention) ──────────────────────

alter table public.competitors enable row level security;
alter table public.competitor_facts enable row level security;
alter table public.tracked_sources enable row level security;
alter table public.alert_rules enable row level security;
alter table public.competitor_events enable row level security;

drop policy if exists "competitors_select_own" on public.competitors;
create policy "competitors_select_own" on public.competitors for select using (auth.uid() = user_id);
drop policy if exists "competitors_insert_own" on public.competitors;
create policy "competitors_insert_own" on public.competitors for insert with check (auth.uid() = user_id);
drop policy if exists "competitors_update_own" on public.competitors;
create policy "competitors_update_own" on public.competitors for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "competitors_delete_own" on public.competitors;
create policy "competitors_delete_own" on public.competitors for delete using (auth.uid() = user_id);

drop policy if exists "competitor_facts_select_own" on public.competitor_facts;
create policy "competitor_facts_select_own" on public.competitor_facts for select using (auth.uid() = user_id);
drop policy if exists "competitor_facts_insert_own" on public.competitor_facts;
create policy "competitor_facts_insert_own" on public.competitor_facts for insert with check (auth.uid() = user_id);
drop policy if exists "competitor_facts_update_own" on public.competitor_facts;
create policy "competitor_facts_update_own" on public.competitor_facts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "competitor_facts_delete_own" on public.competitor_facts;
create policy "competitor_facts_delete_own" on public.competitor_facts for delete using (auth.uid() = user_id);

drop policy if exists "tracked_sources_select_own" on public.tracked_sources;
create policy "tracked_sources_select_own" on public.tracked_sources for select using (auth.uid() = user_id);
drop policy if exists "tracked_sources_insert_own" on public.tracked_sources;
create policy "tracked_sources_insert_own" on public.tracked_sources for insert with check (auth.uid() = user_id);
drop policy if exists "tracked_sources_update_own" on public.tracked_sources;
create policy "tracked_sources_update_own" on public.tracked_sources for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "tracked_sources_delete_own" on public.tracked_sources;
create policy "tracked_sources_delete_own" on public.tracked_sources for delete using (auth.uid() = user_id);

drop policy if exists "alert_rules_select_own" on public.alert_rules;
create policy "alert_rules_select_own" on public.alert_rules for select using (auth.uid() = user_id);
drop policy if exists "alert_rules_insert_own" on public.alert_rules;
create policy "alert_rules_insert_own" on public.alert_rules for insert with check (auth.uid() = user_id);
drop policy if exists "alert_rules_update_own" on public.alert_rules;
create policy "alert_rules_update_own" on public.alert_rules for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "alert_rules_delete_own" on public.alert_rules;
create policy "alert_rules_delete_own" on public.alert_rules for delete using (auth.uid() = user_id);

drop policy if exists "competitor_events_select_own" on public.competitor_events;
create policy "competitor_events_select_own" on public.competitor_events for select using (auth.uid() = user_id);
drop policy if exists "competitor_events_insert_own" on public.competitor_events;
create policy "competitor_events_insert_own" on public.competitor_events for insert with check (auth.uid() = user_id);
drop policy if exists "competitor_events_delete_own" on public.competitor_events;
create policy "competitor_events_delete_own" on public.competitor_events for delete using (auth.uid() = user_id);

-- ── grants (service_role used by server functions; authenticated for any
--    direct client reads, same as businesses) ────────────────────────────────

grant all on public.competitors to service_role;
grant all on public.competitor_facts to service_role;
grant all on public.tracked_sources to service_role;
grant all on public.alert_rules to service_role;
grant all on public.competitor_events to service_role;
grant select, insert, update, delete on public.competitors to authenticated;
grant select, insert, update, delete on public.competitor_facts to authenticated;
grant select, insert, update, delete on public.tracked_sources to authenticated;
grant select, insert, update, delete on public.alert_rules to authenticated;
grant select, insert, update, delete on public.competitor_events to authenticated;
