REVOKE ALL ON FUNCTION public.record_audit_event(text, text, text, uuid, uuid, jsonb, uuid) FROM anon, public;

CREATE OR REPLACE FUNCTION public.record_audit_event(
  _event_type text,
  _status text DEFAULT 'success',
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _property_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _correlation_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
  clean jsonb := coalesce(_metadata, '{}'::jsonb);
  k text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _event_type IS NULL OR length(_event_type) = 0 OR length(_event_type) > 64 THEN
    RAISE EXCEPTION 'Tipo de evento invalido' USING ERRCODE = 'check_violation';
  END IF;
  IF _status IS NULL OR length(_status) > 32 THEN
    _status := 'success';
  END IF;

  FOR k IN SELECT jsonb_object_keys(clean) LOOP
    IF lower(k) ~ '(token|authorization|password|senha|secret|service_role|jwt|cookie|email|prompt|message|content|amount|revenue|profit|cost)' THEN
      clean := clean - k;
    END IF;
  END LOOP;

  INSERT INTO public.audit_events
    (user_id, property_id, event_type, entity_type, entity_id, status, metadata, correlation_id)
  VALUES
    (uid, _property_id, _event_type, _entity_type, _entity_id, _status, clean, _correlation_id)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_audit_event(text, text, text, uuid, uuid, jsonb, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_audit_event(text, text, text, uuid, uuid, jsonb, uuid) TO authenticated, service_role;