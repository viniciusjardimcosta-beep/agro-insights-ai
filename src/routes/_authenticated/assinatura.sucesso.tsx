import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ensureMySubscription } from "@/lib/subscription.functions";
import { getBillingStatus } from "@/lib/billing/billing.functions";

export const Route = createFileRoute("/_authenticated/assinatura/sucesso")({
  head: () => ({
    meta: [
      { title: "Confirmando assinatura — AgroIntel AI" },
      { name: "description", content: "Estamos confirmando sua assinatura do AgroIntel AI." },
      { property: "og:title", content: "Confirmando assinatura — AgroIntel AI" },
      { property: "og:description", content: "Estamos confirmando sua assinatura do AgroIntel AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuccessPage,
});

const POLL_MS = 4000;
const TIMEOUT_MS = 2 * 60_000;

function SuccessPage() {
  const ensure = useServerFn(ensureMySubscription);
  const status = useServerFn(getBillingStatus);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // A confirmação vem SOMENTE do webhook gravado em subscriptions — o redirect não prova nada.
  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => ensure() });
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: () => status() });

  const s = sub.data;
  const confirmed =
    (!!s && ["active", "past_due", "canceled", "expired"].includes(s.status)) || !!billing.data?.recurrenceScheduled;
  const polling = !confirmed && !timedOut;

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      void sub.refetch();
      void billing.refetch();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, sub, billing]);

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {confirmed ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <Loader2 className="h-5 w-5 animate-spin" />}
            {confirmed ? "Assinatura confirmada" : "Estamos confirmando sua assinatura"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          {confirmed ? (
            <p>
              {s?.status === "active"
                ? "Seu plano está ativo."
                : billing.data?.recurrenceScheduled
                  ? "Assinatura registrada. A primeira cobrança acontece ao fim do teste gratuito."
                  : "Veja os detalhes na tela de assinatura."}
            </p>
          ) : timedOut ? (
            <p>
              Recebemos sua solicitação, mas a confirmação ainda não chegou. Isso pode levar alguns minutos — confira mais
              tarde na tela de assinatura.
            </p>
          ) : (
            <p>Recebemos sua solicitação. Assim que o pagamento for confirmado, esta tela atualiza sozinha.</p>
          )}
          <Button asChild>
            <Link to="/configuracoes/assinatura">Ver minha assinatura</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
