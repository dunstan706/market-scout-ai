ALTER TABLE public.market_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.market_alerts FROM anon;
GRANT SELECT, UPDATE ON TABLE public.market_alerts TO authenticated;
GRANT ALL ON TABLE public.market_alerts TO service_role;

DROP POLICY IF EXISTS market_alerts_select_own ON public.market_alerts;
CREATE POLICY market_alerts_select_own
ON public.market_alerts
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS market_alerts_update_own ON public.market_alerts;
CREATE POLICY market_alerts_update_own
ON public.market_alerts
FOR UPDATE
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE EXECUTE ON FUNCTION public.record_affiliate_commission(uuid, text, numeric, integer, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reverse_affiliate_commissions(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_affiliate_commission(uuid, text, numeric, integer, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_affiliate_commissions(text) TO service_role;