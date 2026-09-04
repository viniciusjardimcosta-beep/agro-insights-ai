CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code text NOT NULL DEFAULT 'trial',
  status text NOT NULL DEFAULT 'trialing',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_user_unique UNIQUE (user_id),
  CONSTRAINT subscriptions_status_check CHECK (status IN ('trialing','active','past_due','canceled','expired','incomplete')),
  CONSTRAINT subscriptions_plan_check CHECK (length(plan_code) BETWEEN 1 AND 32)
);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_select_own ON public.subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_subscriptions_status ON public.subscriptions (status);

-- Criação idempotente do trial. Identidade SEMPRE de auth.uid();
-- nenhum parâmetro do cliente influencia plano, status ou datas.
CREATE OR REPLACE FUNCTION public.ensure_subscription()
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  uid uuid := auth.uid();
  sub public.subscriptions;
  trial_days constant integer := 7;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO sub FROM public.subscriptions WHERE user_id = uid;
  IF FOUND THEN
    RETURN sub;
  END IF;

  -- Serializa criações concorrentes do mesmo usuário.
  PERFORM pg_advisory_xact_lock(hashtextextended('subscription:' || uid::text, 0));

  INSERT INTO public.subscriptions (
    user_id, plan_code, status, trial_started_at, trial_ends_at,
    current_period_started_at, current_period_ends_at
  )
  VALUES (
    uid, 'trial', 'trialing', now(), now() + (trial_days || ' days')::interval,
    now(), now() + (trial_days || ' days')::interval
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO sub FROM public.subscriptions WHERE user_id = uid;
  RETURN sub;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_subscription() TO authenticated, service_role;