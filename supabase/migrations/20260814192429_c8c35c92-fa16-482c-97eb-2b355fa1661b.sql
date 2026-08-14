CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_events_select_own ON public.usage_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_usage_events_user_type_created
  ON public.usage_events (user_id, event_type, created_at DESC);
CREATE INDEX idx_usage_events_created_at ON public.usage_events (created_at);

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  _event_type text,
  _hour_limit integer,
  _day_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  hour_used integer;
  day_used integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _event_type IS NULL OR length(_event_type) = 0 OR length(_event_type) > 64 THEN
    RAISE EXCEPTION 'Tipo de evento inválido' USING ERRCODE = 'check_violation';
  END IF;
  IF _hour_limit IS NULL OR _hour_limit < 0 THEN _hour_limit := 0; END IF;
  IF _day_limit IS NULL OR _day_limit < 0 THEN _day_limit := 0; END IF;

  -- Serialize concurrent checks for the same (user, event_type) inside this transaction
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text || ':' || _event_type, 0));

  SELECT
    count(*) FILTER (WHERE created_at > now() - interval '1 hour'),
    count(*) FILTER (WHERE created_at > now() - interval '24 hours')
  INTO hour_used, day_used
  FROM public.usage_events
  WHERE user_id = uid
    AND event_type = _event_type
    AND created_at > now() - interval '24 hours';

  IF (_hour_limit > 0 AND hour_used >= _hour_limit)
     OR (_day_limit > 0 AND day_used >= _day_limit) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'scope', CASE WHEN (_hour_limit > 0 AND hour_used >= _hour_limit) THEN 'hour' ELSE 'day' END
    );
  END IF;

  INSERT INTO public.usage_events (user_id, event_type) VALUES (uid, _event_type);

  RETURN jsonb_build_object('allowed', true, 'scope', null);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_usage_event(_event_type text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _event_type IS NULL OR length(_event_type) = 0 OR length(_event_type) > 64 THEN
    RAISE EXCEPTION 'Tipo de evento inválido' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.usage_events (user_id, event_type) VALUES (uid, _event_type);
END;
$$;

REVOKE ALL ON FUNCTION public.record_usage_event(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_usage_event(text) TO authenticated, service_role;