-- Um customer/assinatura do gateway nunca pode pertencer a dois usuários.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_customer_unique
  ON public.subscriptions (provider_customer_id) WHERE provider_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_subscription_unique
  ON public.subscriptions (provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;