CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  status text NOT NULL DEFAULT 'success',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_events IS 'Auditoria operacional. Retencao recomendada: 90 dias. Nao armazena conteudo sensivel (tokens, mensagens, valores financeiros, PII).';

-- Sem acesso direto do cliente: escrita apenas via funcao segura, leitura apenas administrativa.
REVOKE ALL ON public.audit_events FROM anon, authenticated;
GRANT ALL ON public.audit_events TO service_role;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy para anon/authenticated: tabela indisponivel ao cliente.
CREATE POLICY "audit_events_service_role_all" ON public.audit_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_audit_events_user_created ON public.audit_events (user_id, created_at DESC);
CREATE INDEX idx_audit_events_type_created ON public.audit_events (event_type, created_at DESC);
CREATE INDEX idx_audit_events_correlation ON public.audit_events (correlation_id);

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
  IF _event_type IS NULL OR length(_event_type) = 0 OR length(_event_type) > 64 THEN
    RAISE EXCEPTION 'Tipo de evento invalido' USING ERRCODE = 'check_violation';
  END IF;
  IF _status IS NULL OR length(_status) > 32 THEN
    _status := 'success';
  END IF;

  -- Defesa em profundidade: remove chaves potencialmente sensiveis.
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

REVOKE ALL ON FUNCTION public.record_audit_event(text, text, text, uuid, uuid, jsonb, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.record_audit_event(text, text, text, uuid, uuid, jsonb, uuid) TO authenticated, service_role;