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
