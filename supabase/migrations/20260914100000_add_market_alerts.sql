-- Instant alerts (Advise tier): every big move detected by the daily sweep
-- is stored here, whether or not it produced an email — rows with
-- email_sent_at null but classified red/amber are the "folded into Monday"
-- overflow under the 1-email-per-user-per-day cap, and also power the
-- in-app alert strip on the Monitoring tab.
--
-- Tier gate is enforced in the cron route (advise/expand only), not here.

create table if not exists public.market_alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- DetectedChange.kind that produced this alert.
  kind text not null,
  -- Email renderer kind: price_cut | new_entrant | hours_change |
  -- own_review | own_rating | competitor_rating | general.
  alert_kind text not null default 'general',
  tone text not null,
  headline text not null,
  detail text,
  competitor_name text,
  acknowledged_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists market_alerts_business_idx
  on public.market_alerts (business_id, created_at desc);
create index if not exists market_alerts_user_unacked_idx
  on public.market_alerts (user_id, acknowledged_at, created_at desc);

-- Cooldown lookups: most recent alert per (business, kind, competitor).
create index if not exists market_alerts_cooldown_idx
  on public.market_alerts (business_id, kind, competitor_name, created_at desc);

-- RLS: users see their own alerts; writes go through the service-role cron.
alter table public.market_alerts enable row level security;

drop policy if exists "market_alerts_select_own" on public.market_alerts;
create policy "market_alerts_select_own" on public.market_alerts
  for select using (auth.uid() = user_id);

drop policy if exists "market_alerts_update_own" on public.market_alerts;
create policy "market_alerts_update_own" on public.market_alerts
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on public.market_alerts to service_role;
grant select, update on public.market_alerts to authenticated;
