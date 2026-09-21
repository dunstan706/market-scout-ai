-- Manual "admin privileges" switch.
--
-- DESIGNATED admins (in ADMIN_EMAILS) may toggle their operator bypass on and
-- off from the dashboard. ON = they sail past every paywall as the expand
-- tier. OFF = they read exactly like a free account (their real plan_tier and
-- subscription decide, which for a non-billed admin means: gated like free).
--
-- The column is safe for any account: the server only ever reads it for
-- accounts whose email is in ADMIN_EMAILS, so a non-admin toggling it (or a
-- crafted request) changes nothing.

alter table public.profiles
  add column if not exists admin_privileges_enabled boolean not null default false;
