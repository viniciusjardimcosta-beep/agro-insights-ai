REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_roles, public.billing_eligibility, public.subscriptions FROM anon, authenticated;
REVOKE ALL ON public.user_roles, public.billing_eligibility, public.subscriptions FROM anon;
REVOKE ALL ON public.billing_events, public.billing_checkouts FROM anon, authenticated;
GRANT SELECT ON public.user_roles, public.billing_eligibility, public.subscriptions TO authenticated;