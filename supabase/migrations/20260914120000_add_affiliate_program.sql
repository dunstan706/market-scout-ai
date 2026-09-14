-- In-house affiliate program.
--
-- Attribution model (decided): signup-only — the affiliate whose link drove
-- the signup owns that customer forever ("first attribution wins").
-- Commission model: 10% of each subscription payment (excl. tax), for the
-- first 12 months of the referred customer's subscription; upgrades and
-- renewals naturally commission at their actual amounts. Refunds reverse
-- pending commissions. Commissions mature (pending -> available) after 30
-- days; payouts are manual monthly runs with a $25 minimum.

-- ============ affiliates ============
create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  code text unique not null,
  email text not null,
  name text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'suspended')),
  payout_email text,
  payout_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists affiliates_user_key on public.affiliates (user_id) where user_id is not null;
create index if not exists affiliates_status_idx on public.affiliates (status, created_at);

alter table public.affiliates enable row level security;

drop policy if exists "affiliates_select_own" on public.affiliates;
create policy "affiliates_select_own" on public.affiliates
  for select using (auth.uid() = user_id);

drop policy if exists "affiliates_insert_own" on public.affiliates;
create policy "affiliates_insert_own" on public.affiliates
  for insert with check (auth.uid() = user_id);

drop policy if exists "affiliates_update_own" on public.affiliates;
create policy "affiliates_update_own" on public.affiliates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ affiliate_referrals ============
-- One row per customer account: the affiliate who drove the signup.
create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  referred_user_id uuid not null references auth.users (id) on delete cascade,
  referred_email text,
  source_url text,
  converted_at timestamptz,          -- set when their first payment completes
  created_at timestamptz not null default now(),
  unique (affiliate_id, referred_user_id)
);
create unique index if not exists affiliate_referrals_user_key
  on public.affiliate_referrals (referred_user_id);
create index if not exists affiliate_referrals_affiliate_idx
  on public.affiliate_referrals (affiliate_id, created_at);

alter table public.affiliate_referrals enable row level security;

drop policy if exists "affiliate_referrals_select_own" on public.affiliate_referrals;
create policy "affiliate_referrals_select_own" on public.affiliate_referrals
  for select using (
    exists (
      select 1 from public.affiliates a
      where a.id = affiliate_id and a.user_id = auth.uid()
    )
  );

-- ============ affiliate_commissions ============
create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  referred_user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id text not null,      -- Paddle transaction id
  payment_number integer not null,   -- 1 = first payment, 2..12 = renewals
  amount numeric(12, 2) not null,    -- commission amount (10% of payment excl. tax)
  currency_code text not null default 'USD',
  status text not null default 'pending'
    check (status in ('pending', 'available', 'paid', 'reversed')),
  payable_after timestamptz not null,
  payout_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id)
);
create index if not exists affiliate_commissions_affiliate_idx
  on public.affiliate_commissions (affiliate_id, created_at desc);

alter table public.affiliate_commissions enable row level security;

drop policy if exists "affiliate_commissions_select_own" on public.affiliate_commissions;
create policy "affiliate_commissions_select_own" on public.affiliate_commissions
  for select using (
    exists (
      select 1 from public.affiliates a
      where a.id = affiliate_id and a.user_id = auth.uid()
    )
  );

-- ============ affiliate_payouts ============
create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  amount numeric(12, 2) not null,
  currency_code text not null default 'USD',
  reference text,                    -- bank transfer reference / receipt
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists affiliate_payouts_affiliate_idx
  on public.affiliate_payouts (affiliate_id, paid_at desc);

alter table public.affiliate_payouts enable row level security;

drop policy if exists "affiliate_payouts_select_own" on public.affiliate_payouts;
create policy "affiliate_payouts_select_own" on public.affiliate_payouts
  for select using (
    exists (
      select 1 from public.affiliates a
      where a.id = affiliate_id and a.user_id = auth.uid()
    )
  );

-- ============ commission engine ============
-- Called by the Paddle webhook on transaction.completed. Inserts the
-- commission for this payment if the buyer was referred, the affiliate is
-- approved, and the payment falls within the first 12 months of the
-- subscription. Idempotent via the unique(transaction_id) constraint —
-- replayed events are a no-op. Returns the inserted commission id (or null).
create or replace function public.record_affiliate_commission(
  p_referred_user_id uuid,
  p_transaction_id text,
  p_payment_amount numeric,          -- payment excl. tax, major units
  p_payment_number integer,
  p_subscription_start timestamptz,
  p_event_time timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral record;
  v_affiliate record;
  v_commission_id uuid;
begin
  if p_referred_user_id is null then
    return null;
  end if;

  select * into v_referral
  from public.affiliate_referrals
  where referred_user_id = p_referred_user_id
  limit 1;

  if not found then
    return null; -- customer was never referred
  end if;

  select * into v_affiliate
  from public.affiliates
  where id = v_referral.affiliate_id
  limit 1;

  if not found or v_affiliate.status is distinct from 'approved' then
    return null; -- affiliate pending/suspended earns nothing
  end if;

  -- Stamp conversion on the first qualifying payment.
  if v_referral.converted_at is null then
    update public.affiliate_referrals
    set converted_at = coalesce(p_event_time, now())
    where id = v_referral.id;
  end if;

  -- First 12 months only: payment_number 1..12 (1 = first payment).
  if p_payment_number is null or p_payment_number < 1 or p_payment_number > 12 then
    return null;
  end if;

  if p_payment_amount is null or p_payment_amount <= 0 then
    return null;
  end if;

  insert into public.affiliate_commissions (
    affiliate_id, referred_user_id, transaction_id,
    payment_number, amount, currency_code, status, payable_after
  ) values (
    v_referral.affiliate_id,
    p_referred_user_id,
    p_transaction_id,
    p_payment_number,
    round(p_payment_amount * 0.10, 2),
    'USD',
    'pending',
    coalesce(p_event_time, now()) + interval '30 days'
  )
  on conflict (transaction_id) do nothing
  returning id into v_commission_id;

  return v_commission_id;
end;
$$;

-- Reverse the commission(s) for a refunded transaction. Replayed events are
-- no-ops (already-reversed rows stay reversed).
create or replace function public.reverse_affiliate_commissions(
  p_transaction_id text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.affiliate_commissions
  set status = 'reversed', updated_at = now()
  where transaction_id = p_transaction_id
    and status in ('pending', 'available');
$$;

grant execute on function public.record_affiliate_commission(uuid, text, numeric, integer, timestamptz, timestamptz) to service_role;
grant execute on function public.reverse_affiliate_commissions(text) to service_role;
revoke execute on function public.record_affiliate_commission(uuid, text, numeric, integer, timestamptz, timestamptz) from anon, authenticated;
revoke execute on function public.reverse_affiliate_commissions(text) from anon, authenticated;
