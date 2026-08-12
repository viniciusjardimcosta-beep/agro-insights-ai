CREATE TABLE public.intelligence_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  alert_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','high','medium')),
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  metric_name text,
  metric_value text,
  previous_value text,
  impact text,
  action_label text,
  action_route text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alert_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.intelligence_alerts TO authenticated;
GRANT ALL ON public.intelligence_alerts TO service_role;

ALTER TABLE public.intelligence_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY intelligence_alerts_all_own ON public.intelligence_alerts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_intelligence_alerts_user_status ON public.intelligence_alerts (user_id, status);

CREATE OR REPLACE FUNCTION public.enforce_alerts_property_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE owner uuid;
BEGIN
  IF NEW.property_id IS NULL THEN RETURN NEW; END IF;
  SELECT user_id INTO owner FROM public.properties WHERE id = NEW.property_id;
  IF owner IS NULL OR owner <> NEW.user_id THEN
    RAISE EXCEPTION 'Recurso não encontrado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_alerts_property_owner
BEFORE INSERT OR UPDATE ON public.intelligence_alerts
FOR EACH ROW EXECUTE FUNCTION public.enforce_alerts_property_owner();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_alerts_updated_at
BEFORE UPDATE ON public.intelligence_alerts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();