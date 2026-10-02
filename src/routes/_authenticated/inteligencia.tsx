import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Brain,
  CheckCircle2,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BRL } from "@/lib/calc";
import { getFarmSnapshot } from "@/lib/data.functions";
import { listAlerts } from "@/lib/alerts.functions";
import { listDiagnostics } from "@/lib/diagnostics.functions";
import { listScenarios } from "@/lib/scenarios.functions";
import {
  buildIntelligenceSnapshot,
  getEvolution,
  getNextAction,
  getPrimaryOpportunity,
  getPrimaryProblem,
  getPriorityAlerts,
  getPriorityLevel,
  type Alert as PriorityAlert,
  type ActionLink,
  type DiagnosticLite,
  type ScenarioLite,
} from "@/lib/intelligence";
import { PremiumRouteGuard } from "@/components/premium-route-guard";
import { FEATURES } from "@/lib/entitlements";

export const Route = createFileRoute("/_authenticated/inteligencia")({
  head: () => ({
    meta: [
      { title: "Central de Inteligência — AgroIntel AI" },
      {
        name: "description",
        content:
          "Prioridades objetivas da sua fazenda: principal problema, maior oportunidade e próxima ação recomendada.",
      },
      { property: "og:title", content: "Central de Inteligência — AgroIntel AI" },
      {
        property: "og:description",
        content: "O que merece sua atenção hoje, com base nos dados da sua propriedade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <PremiumRouteGuard feature={FEATURES.INTELLIGENCE}>
      <InteligenciaPage />
    </PremiumRouteGuard>
  ),
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Erro: {(error as Error).message}
    </div>
  ),
});

const snapshotQuery = queryOptions({
  queryKey: ["farm-snapshot"],
  queryFn: () => getFarmSnapshot(),
});
const diagnosticsQuery = queryOptions({
  queryKey: ["diagnostics"],
  queryFn: () => listDiagnostics(),
});
const scenariosQuery = queryOptions({
  queryKey: ["scenarios"],
  queryFn: () => listScenarios(),
});
const persistedAlertsQuery = queryOptions({
  queryKey: ["alerts"],
  queryFn: () => listAlerts(),
});

function scoreColor(score: number) {
  if (score >= 75) return "text-primary";
  if (score >= 50) return "text-warning";
  return "text-destructive";
}

function ActionButton({ link, variant = "outline" }: { link?: ActionLink; variant?: "outline" | "default" }) {
  if (!link) return null;
  return (
    <Button asChild size="sm" variant={variant}>
      <Link to={link.to}>{link.label}</Link>
    </Button>
  );
}

function severityBadge(severity: PriorityAlert["severity"]) {
  const map = {
    critical: { label: "Crítico", cls: "bg-destructive text-destructive-foreground" },
    high: { label: "Alto", cls: "bg-warning text-warning-foreground" },
    medium: { label: "Médio", cls: "bg-muted text-muted-foreground" },
  } as const;
  const s = map[severity];
  return <Badge className={s.cls}>{s.label}</Badge>;
}

function InteligenciaPage() {
  const snapQ = useQuery(snapshotQuery);
  const diagQ = useQuery(diagnosticsQuery);
  const scenQ = useQuery(scenariosQuery);
  const persistedQ = useQuery(persistedAlertsQuery);
  const activeAlerts = ((persistedQ.data ?? []) as { id: string; status: string; title: string; message: string; severity: string; metric_value: string | null }[])
    .filter((a) => a.status === "active" || a.status === "acknowledged")
    .slice(0, 3);

  const loading = snapQ.isLoading || diagQ.isLoading || scenQ.isLoading;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando inteligência...
      </div>
    );
  }

  const raw = snapQ.data ?? { properties: [], fields: [], costs: [], prices: [] };
  const snap = buildIntelligenceSnapshot({
    properties: (raw.properties ?? []) as { id?: string; name: string }[],
    fields: (raw.fields ?? []) as never,
    costs: (raw.costs ?? []) as never,
    prices: (raw.prices ?? []) as never,
    diagnostics: (diagQ.data ?? []) as unknown as DiagnosticLite[],
    scenarios: (scenQ.data ?? []) as unknown as ScenarioLite[],
  });

  const problem = getPrimaryProblem(snap);
  const opportunity = getPrimaryOpportunity(snap);
  const nextAction = getNextAction(snap);
  const evolution = getEvolution(snap);
  const alerts = getPriorityAlerts(snap, 3);
  const level = getPriorityLevel(snap, alerts);

  const noData = !snap.hasFields;

  return (
    <div className="space-y-6">
      {/* 1. Cabeçalho */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Brain className="h-6 w-6 text-primary" /> Central de Inteligência
          </h1>
          <p className="text-muted-foreground">O que merece sua atenção hoje.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {snap.propertyName ?? "Nenhuma propriedade cadastrada"}
            {" · "}
            {snap.lastAnalysisAt
              ? `Última análise em ${new Date(snap.lastAnalysisAt).toLocaleDateString("pt-BR")}`
              : "Nenhuma análise gerada"}
          </p>
        </div>
        <div className="rounded-xl border px-5 py-3 text-center">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Saúde Financeira
          </div>
          <div className={`text-3xl font-bold ${scoreColor(snap.score)}`}>{snap.score}/100</div>
        </div>
      </header>

      {noData ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="font-medium">Ainda não há dados suficientes.</p>
            <p className="text-sm text-muted-foreground">
              Cadastre sua propriedade e seus talhões para receber prioridades.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <ActionButton link={{ label: "Cadastrar propriedade", to: "/propriedades" }} />
              <ActionButton link={{ label: "Cadastrar talhões", to: "/talhoes" }} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 2 + 3 */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className={problem ? "border-destructive/40" : undefined}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" /> Principal problema
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {problem ? (
                  <>
                    <div className="text-base font-semibold">{problem.title}</div>
                    <p className="text-muted-foreground">{problem.detail}</p>
                    <div>
                      <span className="text-muted-foreground">Impacto na nota: </span>
                      <span className="font-semibold text-destructive">{problem.points} pontos</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Ação sugerida: </span>
                      {problem.action}
                    </div>
                    <ActionButton link={problem.link} />
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Nenhuma penalidade relevante identificada nos dados atuais.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" /> Maior oportunidade
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {opportunity ? (
                  <>
                    <div className="text-base font-semibold">{opportunity.title}</div>
                    <p className="text-muted-foreground">{opportunity.detail}</p>
                    {opportunity.simulatedScore !== undefined && (
                      <div className="grid grid-cols-2 gap-3">
                        <Stat label="Nota atual" value={String(opportunity.currentScore)} />
                        <Stat label="Nota simulada" value={String(opportunity.simulatedScore)} />
                      </div>
                    )}
                    {opportunity.scorePotential !== undefined && opportunity.scorePotential > 0 && (
                      <div>
                        <span className="text-muted-foreground">Potencial: </span>
                        <span className="font-semibold text-primary">
                          +{opportunity.scorePotential} pontos
                        </span>
                      </div>
                    )}
                    {opportunity.profitDelta !== undefined && (
                      <div>
                        <span className="text-muted-foreground">Lucro: </span>
                        <span
                          className={
                            opportunity.profitDelta >= 0
                              ? "font-semibold text-primary"
                              : "font-semibold text-destructive"
                          }
                        >
                          {opportunity.profitDelta >= 0 ? "+" : ""}
                          {BRL.format(opportunity.profitDelta)}
                        </span>
                      </div>
                    )}
                    <ActionButton link={opportunity.link} variant="default" />
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">
                      Nenhuma oportunidade identificada nos dados atuais. Simule mudanças para
                      descobrir ganhos possíveis.
                    </p>
                    <ActionButton link={{ label: "Simular solução", to: "/simulador" }} />
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 4 + 5 */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" /> Próxima ação recomendada
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-medium">{nextAction.action}</p>
                {nextAction.available && nextAction.reason && (
                  <p className="text-muted-foreground">Motivo: {nextAction.reason}</p>
                )}
                <ActionButton
                  link={nextAction.link}
                  variant={nextAction.available ? "outline" : "default"}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evolução da Saúde Financeira</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {evolution.available ? (
                  <>
                    <div className="flex items-center gap-3 text-lg font-semibold">
                      <span className="text-muted-foreground">{evolution.previous}</span>
                      <span>→</span>
                      <span className={scoreColor(evolution.current ?? 0)}>{evolution.current}</span>
                      <span
                        className={`flex items-center gap-1 text-sm ${
                          (evolution.delta ?? 0) >= 0 ? "text-primary" : "text-destructive"
                        }`}
                      >
                        {(evolution.delta ?? 0) >= 0 ? (
                          <ArrowUp className="h-4 w-4" />
                        ) : (
                          <ArrowDown className="h-4 w-4" />
                        )}
                        {(evolution.delta ?? 0) > 0 ? "+" : ""}
                        {evolution.delta} pontos
                      </span>
                    </div>
                    {evolution.causes.length > 0 && (
                      <ul className="space-y-1">
                        {evolution.causes.map((c) => (
                          <li key={c.display} className="flex justify-between gap-3">
                            <span className="text-muted-foreground">{c.display}</span>
                            <span
                              className={
                                c.impact >= 0 ? "font-medium text-primary" : "font-medium text-destructive"
                              }
                            >
                              {c.impact > 0 ? "+" : ""}
                              {c.impact} pts
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <ActionButton link={{ label: "Ver Diagnóstico", to: "/diagnostico" }} />
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">{evolution.message}</p>
                    <ActionButton link={{ label: "Ver Diagnóstico", to: "/diagnostico" }} />
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 6 / 7 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                Alertas ativos
                <Button asChild size="sm" variant="outline">
                  <Link to="/alertas">Ver todos os alertas</Link>
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {activeAlerts.length === 0 ? (
                <>
                  <p className="font-medium">Sem alertas prioritários no momento.</p>
                  <p className="text-muted-foreground">
                    Continuaremos acompanhando os indicadores da propriedade.
                  </p>
                </>
              ) : (
                activeAlerts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <div>
                      <div className="font-medium">{a.title}</div>
                      <div className="text-muted-foreground">{a.metric_value ?? a.message}</div>
                    </div>
                    {severityBadge(a.severity as PriorityAlert["severity"])}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Alertas prioritários
                {alerts.length > 0 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    (prioridade {level === "critical" ? "crítica" : level === "high" ? "alta" : "média"})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {alerts.length === 0 ? (
                <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center gap-2 font-semibold text-primary">
                    <CheckCircle2 className="h-5 w-5" /> Situação financeira estável
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Não identificamos alertas prioritários nos dados atuais.
                  </p>
                  {opportunity && (
                    <p className="text-sm">
                      <span className="font-medium">Oportunidade em destaque: </span>
                      {opportunity.title} — {opportunity.detail}
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {alerts.map((a) => (
                    <div key={a.key} className="space-y-2 rounded-lg border p-4 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{a.title}</span>
                        {severityBadge(a.severity)}
                      </div>
                      <p className="text-muted-foreground">{a.reason}</p>
                      <div>
                        <span className="text-muted-foreground">Métrica: </span>
                        {a.metric}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Impacto: </span>
                        {a.impact}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Ação: </span>
                        {a.action}
                      </div>
                      <ActionButton link={a.link} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
