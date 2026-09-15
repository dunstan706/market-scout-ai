ALTER TABLE public.market_alerts
ADD COLUMN IF NOT EXISTS alert_kind text NOT NULL DEFAULT 'general';