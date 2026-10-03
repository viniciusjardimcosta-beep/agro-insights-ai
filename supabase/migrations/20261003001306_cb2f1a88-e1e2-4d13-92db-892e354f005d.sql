CREATE TABLE public.billing_eligibility (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  founder_eligible boolean NOT NULL DEFAULT false,
  granted_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.billing_eligibility TO authenticated;
GRANT ALL ON public.billing_eligibility TO service_role;
ALTER TABLE public.billing_eligibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_eligibility_select_own ON public.billing_eligibility
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY billing_eligibility_service_all ON public.billing_eligibility
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_billing_eligibility_updated_at BEFORE UPDATE ON public.billing_eligibility
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.billing_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  plan_code text NOT NULL,
  provider_checkout_id text,
  checkout_url text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_checkouts_status_check CHECK (status IN ('pending','paid','canceled','expired','failed')),
  CONSTRAINT billing_checkouts_provider_checkout_unique UNIQUE (provider, provider_checkout_id)
);
CREATE UNIQUE INDEX billing_checkouts_one_pending_per_user
  ON public.billing_checkouts (user_id) WHERE status = 'pending';
GRANT ALL ON public.billing_checkouts TO service_role;
ALTER TABLE public.billing_checkouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_checkouts_service_all ON public.billing_checkouts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_billing_checkouts_updated_at BEFORE UPDATE ON public.billing_checkouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS subscriptions_provider_subscription_idx ON public.subscriptions (provider_subscription_id);
CREATE INDEX IF NOT EXISTS subscriptions_provider_customer_idx ON public.subscriptions (provider_customer_id);