CREATE OR REPLACE FUNCTION public.protect_profile_billing_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.plan_tier IS DISTINCT FROM 'free'
         OR NEW.subscription_status IS NOT NULL
         OR NEW.cancel_at_period_end IS DISTINCT FROM false
         OR NEW.current_period_end IS NOT NULL
         OR NEW.billing_cadence IS NOT NULL
         OR NEW.stripe_customer_id IS NOT NULL
         OR NEW.paddle_customer_id IS NOT NULL
         OR NEW.paddle_subscription_id IS NOT NULL THEN
        RAISE EXCEPTION 'Billing fields may only be changed by the billing service'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier
       OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
       OR NEW.cancel_at_period_end IS DISTINCT FROM OLD.cancel_at_period_end
       OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
       OR NEW.billing_cadence IS DISTINCT FROM OLD.billing_cadence
       OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
       OR NEW.paddle_customer_id IS DISTINCT FROM OLD.paddle_customer_id
       OR NEW.paddle_subscription_id IS DISTINCT FROM OLD.paddle_subscription_id THEN
      RAISE EXCEPTION 'Billing fields may only be changed by the billing service'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_billing_fields() FROM PUBLIC;

CREATE TRIGGER protect_profile_billing_fields_before_write
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_billing_fields();