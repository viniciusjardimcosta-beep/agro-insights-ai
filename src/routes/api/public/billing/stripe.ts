// Webhook do Stripe. Público apenas para o gateway alcançar.
// Autenticação: header `Stripe-Signature` (HMAC-SHA256 do corpo BRUTO com o segredo whsec_…,
// tolerância de 5 min) validado ANTES de qualquer escrita. O Stripe considera sucesso qualquer 2xx
// e reenvia em caso contrário; a idempotência é garantida pelo id do evento (evt_…).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/billing/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { resolveProvider } = await import("@/lib/billing/provider.server");
        const provider = resolveProvider();
        if (!provider || provider.id !== "stripe") return new Response("not configured", { status: 503 });

        // Corpo bruto: a assinatura é calculada sobre o texto exato recebido.
        const rawBody = await request.text();
        if (rawBody.length > 200_000) return new Response("too large", { status: 413 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const wh = await import("@/lib/billing/webhook.server");

        const verified = await provider.verifyWebhook({ rawBody, headers: request.headers });
        if (!verified.ok) {
          await wh.recordSystemAudit(supabaseAdmin, {
            userId: null,
            eventType: verified.reason === "invalid_signature" ? "webhook_invalid_signature" : "webhook_processing_failed",
            status: "blocked",
            metadata: { source: "stripe", reason: verified.reason },
          });
          return new Response("invalid", { status: verified.reason === "invalid_signature" ? 401 : 400 });
        }

        const key = { provider: provider.id, providerEventId: verified.providerEventId };
        const claimed = await wh.claimWebhookEvent(supabaseAdmin, { ...key, eventType: verified.eventType });
        if (!claimed) return new Response("duplicate", { status: 200 });

        try {
          const result = await wh.applyBillingEvent(supabaseAdmin, provider, verified.event);
          await wh.finishWebhookEvent(supabaseAdmin, { ...key, status: result });
          return new Response("ok", { status: 200 });
        } catch (err) {
          if (err instanceof wh.RetryLaterError) {
            await wh.releaseWebhookEvent(supabaseAdmin, key);
            return new Response("retry", { status: 503 });
          }
          await wh.finishWebhookEvent(supabaseAdmin, { ...key, status: "failed", errorCode: "PROCESSING_FAILED" });
          await wh.recordSystemAudit(supabaseAdmin, {
            userId: null,
            eventType: "webhook_processing_failed",
            status: "failure",
            metadata: { source: "stripe", error_code: "PROCESSING_FAILED" },
          });
          console.error("[billing] webhook falhou", { event_type: verified.eventType });
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});
