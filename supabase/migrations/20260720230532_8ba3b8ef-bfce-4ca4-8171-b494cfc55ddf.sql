
-- 1) Restrict ai_messages.role
UPDATE public.ai_messages SET role = 'user' WHERE role NOT IN ('user','assistant','system');
ALTER TABLE public.ai_messages
  ADD CONSTRAINT ai_messages_role_check CHECK (role IN ('user','assistant','system'));

-- 2) Cross-user FK ownership triggers (generic "not found" to avoid enumeration)
CREATE OR REPLACE FUNCTION public.enforce_fields_property_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner uuid;
BEGIN
  SELECT user_id INTO owner FROM public.properties WHERE id = NEW.property_id;
  IF owner IS NULL OR owner <> NEW.user_id THEN
    RAISE EXCEPTION 'Recurso não encontrado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_fields_property_owner ON public.fields;
CREATE TRIGGER trg_fields_property_owner
  BEFORE INSERT OR UPDATE OF property_id, user_id ON public.fields
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fields_property_owner();

CREATE OR REPLACE FUNCTION public.enforce_costs_field_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner uuid;
BEGIN
  SELECT user_id INTO owner FROM public.fields WHERE id = NEW.field_id;
  IF owner IS NULL OR owner <> NEW.user_id THEN
    RAISE EXCEPTION 'Recurso não encontrado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_costs_field_owner ON public.costs;
CREATE TRIGGER trg_costs_field_owner
  BEFORE INSERT OR UPDATE OF field_id, user_id ON public.costs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_costs_field_owner();

CREATE OR REPLACE FUNCTION public.enforce_scenarios_property_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner uuid;
BEGIN
  IF NEW.property_id IS NULL THEN RETURN NEW; END IF;
  SELECT user_id INTO owner FROM public.properties WHERE id = NEW.property_id;
  IF owner IS NULL OR owner <> NEW.user_id THEN
    RAISE EXCEPTION 'Recurso não encontrado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_scenarios_property_owner ON public.simulated_scenarios;
CREATE TRIGGER trg_scenarios_property_owner
  BEFORE INSERT OR UPDATE OF property_id, user_id ON public.simulated_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scenarios_property_owner();

REVOKE EXECUTE ON FUNCTION public.enforce_fields_property_owner() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_costs_field_owner() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_scenarios_property_owner() FROM public, anon, authenticated;
