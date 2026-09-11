DROP POLICY IF EXISTS "waitlist_signups_insert_public" ON public.waitlist_signups;

REVOKE INSERT ON TABLE public.waitlist_signups FROM anon;

CREATE POLICY "waitlist_signups_insert_own"
  ON public.waitlist_signups
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));