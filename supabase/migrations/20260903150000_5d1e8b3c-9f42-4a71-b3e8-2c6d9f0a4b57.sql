-- Idempotent weekly email delivery: mark each brief after its email is sent
-- so scheduled retries never double-send.
alter table public.briefs add column emailed_at timestamptz;

-- Link waitlist signups to authenticated accounts when a user signs up with
-- the same email, so waitlist data can prefill their dashboard profile.
alter table public.waitlist_signups add column user_id uuid references auth.users(id) on delete set null;
create index waitlist_signups_user_id_idx on public.waitlist_signups (user_id);
