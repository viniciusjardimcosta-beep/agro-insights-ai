# AGENTS.md

- Billing goes through the provider adapter in `src/lib/billing/providers/*.server.ts` only; why: keeps gateway APIs and secrets out of the rest of the app.
- Webhooks never apply event payloads; they re-fetch the subscription from the gateway by persisted ID and reconcile via pure `reconcile.ts`; why: makes out-of-order and tampered events harmless.
- Billing stays fail-closed to the gateway's test mode until a sprint explicitly enables live; why: no real charges before end-to-end validation.
