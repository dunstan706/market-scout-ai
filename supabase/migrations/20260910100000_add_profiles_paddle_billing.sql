-- Paddle billing state on profiles. Paddle (merchant of record) keeps plan
-- state in sync via webhooks; these columns are the app-side mirror the
-- dashboard and profile pages read.
--
-- plan_tier: 'free' (default, existing accounts grandfathered) | 'watch' | 'advise'
-- billing_cadence: 'monthly' | 'yearly' — which cadence the subscription uses.
-- paddle_subscription_id: the subscription currently attached to the profile.
-- Revocation webhooks from any other subscription id are ignored, so an
-- out-of-order cancel for an old subscription can't strip a newer plan.

alter table public.profiles
  add column if not exists paddle_customer_id text,
  add column if not exists paddle_subscription_id text,
  add column if not exists plan_tier text not null default 'free',
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists billing_cadence text
    check (billing_cadence in ('monthly', 'yearly'));

-- Index for the webhook's customer → profile lookup.
create index if not exists profiles_paddle_customer_id_idx
  on public.profiles (paddle_customer_id)
  where paddle_customer_id is not null;
