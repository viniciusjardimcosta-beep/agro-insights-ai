import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClock, CreditCard, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSubscription } from "@/hooks/use-subscription";
import { PREMIUM_FEATURES, SUBSCRIPTION_STATUS, TRIAL_DAYS } from "@/lib/entitlements";

export const Route = createFileRoute("/_authenticated/configuracoes/assinatura")({
  head: () => ({
    meta: [
      { title: "Assinatura e teste gratuito — AgroIntel AI" },
      {
        name: "description",
        content:
          "Acompanhe o status da sua assinatura AgroIntel AI, os dias restantes do teste gratuito e os recursos incluídos.",
      },
      { property: "og:title", content: "Assinatura e teste gratuito — AgroIntel AI" },
      { property: "og:description", content: "Status da assinatura e do teste gratuito do AgroIntel AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubscriptionPage,
});

const FEATURE_LABELS: Record<string, string> = {
  diagnostic: "Diagnóstico por IA",
  ai_consultant: "Consultor IA",
  intelligence: "Central de Inteligência",
  simulator: "Simulador de Cenários",
  alerts: "Alertas inteligentes",
  executive_report: "Relatório Executivo em PDF",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "—";

function SubscriptionPage() {
  const { access, isLoading } = useSubscription();

  const title = (() => {
    if (!access) return "Assinatura";
    if (access.isTrial) return "Teste gratuito";
    if (access.effectiveStatus === SUBSCRIPTION_STATUS.ACTIVE) return "Plano Pro";
    if (access.status === SUBSCRIPTION_STATUS.CANCELED) return "Assinatura cancelada";
    if (access.status === SUBSCRIPTION_STATUS.PAST_DUE) return "Pagamento pendente";
    return "Seu teste terminou";
  })();

  const badge = (() => {
    if (!access) return null;
    if (access.isTrial) return <Badge>Em teste</Badge>;
    if (access.accessLevel === "full") return <Badge>Ativo</Badge>;
    return <Badge variant="destructive">Sem acesso premium</Badge>;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Assinatura</h1>
        <p className="text-muted-foreground">
          Acompanhe seu acesso ao AgroIntel AI. Nenhuma cobrança está ativa nesta etapa.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" /> {title}
            </CardTitle>
            {badge}
          </div>
          <CardDescription>
            {isLoading
              ? "Carregando seu status…"
              : access?.isTrial
                ? `Teste gratuito de ${TRIAL_DAYS} dias com todos os recursos do plano Pro.`
                : access?.accessLevel === "full"
                  ? "Todos os recursos estão liberados."
                  : "Os recursos premium estão bloqueados até a contratação de um plano."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {access?.isTrial && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4">
              <CalendarClock className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold">
                  {access.trialDaysRemaining === 1
                    ? "1 dia restante"
                    : `${access.trialDaysRemaining} dias restantes`}
                </p>
                <p className="text-sm text-muted-foreground">
                  Encerra em {fmtDate(access.trialEndsAt)}.
                </p>
              </div>
            </div>
          )}

          {access && !access.isTrial && access.accessLevel === "full" && (
            <p className="text-sm text-muted-foreground">
              Período atual válido até {fmtDate(access.currentPeriodEndsAt)}.
              {access.cancelAtPeriodEnd ? " O cancelamento já está agendado para o fim do período." : ""}
            </p>
          )}

          {access && access.accessLevel !== "full" && (
            <p className="text-sm text-muted-foreground">
              Seu acesso premium terminou em {fmtDate(access.trialEndsAt ?? access.currentPeriodEndsAt)}. Você
              continua com acesso ao cadastro da fazenda, às configurações, à exportação e à exclusão dos seus dados.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button disabled title="Os planos comerciais ainda não estão disponíveis.">
              <Sparkles className="mr-2 h-4 w-4" /> Ver planos
            </Button>
            <Button variant="outline" asChild>
              <Link to="/configuracoes">Voltar às configurações</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Nenhum meio de pagamento está conectado nesta etapa e nenhum dado de cartão é armazenado.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recursos do plano</CardTitle>
          <CardDescription>Incluídos no teste gratuito e no plano Pro.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${
                    access?.accessLevel === "full" ? "bg-primary" : "bg-muted-foreground/40"
                  }`}
                />
                {FEATURE_LABELS[f] ?? f}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
