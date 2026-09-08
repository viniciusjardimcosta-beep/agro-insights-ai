CREATE TABLE public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT billing_events_provider_event_unique UNIQUE (provider, provider_event_id),
  CONSTRAINT billing_events_status_check CHECK (status IN ('received','processed','ignored','failed'))
);

CREATE INDEX billing_events_created_at_idx ON public.billing_events (created_at DESC);

-- Acesso exclusivo do servidor: nenhum GRANT para anon/authenticated.
GRANT ALL ON public.billing_events TO service_role;

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_events_service_role_all ON public.billing_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);