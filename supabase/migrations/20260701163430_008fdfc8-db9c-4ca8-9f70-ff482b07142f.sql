CREATE TABLE public.simulated_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  scenario_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  score_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  simulated_score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX simulated_scenarios_user_created_idx ON public.simulated_scenarios (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.simulated_scenarios TO authenticated;
GRANT ALL ON public.simulated_scenarios TO service_role;

ALTER TABLE public.simulated_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scenarios"
  ON public.simulated_scenarios FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scenarios"
  ON public.simulated_scenarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scenarios"
  ON public.simulated_scenarios FOR DELETE
  USING (auth.uid() = user_id);