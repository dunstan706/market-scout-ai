ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_privileges_enabled boolean NOT NULL DEFAULT false;