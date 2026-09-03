-- waitlist_signups had RLS enabled with no policies, which blocks every
-- non-service-role access path. Open up exactly the two flows the product needs:
--  1. Anyone can submit the public waitlist form (anon or signed-in).
--  2. Signed-in users can read their own signup (e.g. a "you're on the list"
--     state or prefill), but never the whole list.
-- Service-role access (the server functions) is unaffected: RLS is bypassed,
-- and the existing `grant all ... to service_role` still covers it.

-- Public join: anon + authenticated may insert. Signed-in users may tag their
-- own row with user_id but cannot insert a row owned by someone else.
create policy "waitlist_signups_insert_public"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- Own-signup read: a user may select only rows linked to their account.
create policy "waitlist_signups_select_own"
  on public.waitlist_signups
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- RLS policies do not grant table privileges; make sure anon/authenticated
-- actually have the needed permissions (default privileges usually cover this
-- in fresh Supabase projects, but be explicit to be safe).
grant insert on public.waitlist_signups to anon, authenticated;
grant select on public.waitlist_signups to authenticated;
