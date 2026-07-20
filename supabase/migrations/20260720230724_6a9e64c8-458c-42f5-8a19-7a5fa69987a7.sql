
CREATE OR REPLACE FUNCTION public.enforce_ai_messages_thread_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner uuid;
BEGIN
  SELECT user_id INTO owner FROM public.ai_threads WHERE id = NEW.thread_id;
  IF owner IS NULL OR owner <> NEW.user_id THEN
    RAISE EXCEPTION 'Recurso não encontrado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_ai_messages_thread_owner ON public.ai_messages;
CREATE TRIGGER trg_ai_messages_thread_owner
  BEFORE INSERT OR UPDATE OF thread_id, user_id ON public.ai_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ai_messages_thread_owner();

REVOKE EXECUTE ON FUNCTION public.enforce_ai_messages_thread_owner() FROM public, anon, authenticated;

-- Clean up the audit-test row that slipped in before the trigger existed
DELETE FROM public.ai_messages m
 USING public.ai_threads t
 WHERE m.thread_id = t.id AND m.user_id <> t.user_id;
