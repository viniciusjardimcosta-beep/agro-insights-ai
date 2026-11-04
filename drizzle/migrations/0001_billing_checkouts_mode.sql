ALTER TABLE public.billing_checkouts
  ADD COLUMN mode text NOT NULL DEFAULT 'subscription';

ALTER TABLE public.billing_checkouts
  ADD CONSTRAINT billing_checkouts_mode_check CHECK (mode IN ('subscription', 'setup'));