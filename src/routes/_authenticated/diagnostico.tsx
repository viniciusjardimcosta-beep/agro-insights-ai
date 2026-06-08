import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BRL } from "@/lib/calc";
import {
  generateDiagnostic,
  listDiagnostics,
  type DiagnosticReport,
} from "@/lib/diagnostics.functions";

export const Route = createFileRoute("/_authenticated/diagnostico")({
  head: () => ({ meta: [{ title: "Diagnóstico — AgroIntel AI" }] }),
  component: DiagnosticoPage,
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Erro: {error.message}
    </div>
  ),
});

const listQuery = queryOptions({
  queryKey: ["diagnostics"],
  queryFn: () => listDiagnostics(),
});

function scoreColor(score: number) {
  if (score >= 75) return "text-primary";
  if (score >= 50) return "text-warning";
  return "text-destructive";
}
function scoreLabel(score: number) {
  if (score >= 85) return "Excelente";
  if (score >= 70) return "Saudável";
  if (score >= 50) return "Atenção";
  if (score >= 30) return "Frágil";
  return "Crítica";
}

function DiagnosticoPage() {
  const { data: history = [], isLoading } = useQuery(listQuery);
  const qc = useQueryClient();
  const gen = useServerFn(generateDiagnostic);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const current = history.find((d) => d.id === selectedId) ?? history[0];
  const report = (current?.report as DiagnosticReport | undefined) ?? null;

  async function run() {
    setBusy(true);
    try {
      const created = await gen();
      await qc.invalidateQueries({ queryKey: ["diagnostics"] });
      await qc.invalidateQueries({ queryKey: ["latest-diagnostic"] });
      if (created?.id) setSelectedId(created.id);
      toast.success("Diagnóstico gerado!");
    } catch (e) {
      toast.error("Erro ao gerar diagnóstico", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Diagnóstico Automático</h1>
          <p className="text-sm text-muted-foreground">
            A IA analisa seus dados e gera um relatório financeiro completo.
          </p>
        </div>
        <Button onClick={run} disabled={busy} size="lg">
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {history.length === 0 ? "Gerar Diagnóstico" : "Gerar Novo Diagnóstico"}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando histórico...</p>}

      {!isLoading && history.length === 0 && !busy && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-lg font-semibold">Nenhum diagnóstico ainda</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Clique em <strong>Gerar Diagnóstico</strong> para que a IA analise sua fazenda.
            </p>
          </CardContent>
        </Card>
      )}

      {report && current && (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-6">
            {/* Health score */}
            <Card className="shadow-[var(--shadow-card)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  🏥 Saúde Financeira
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-4">
                  <ScoreWithBreakdown
                    score={current.health_score}
                    breakdown={Array.isArray(report.scoreBreakdown) ? report.scoreBreakdown : []}
                    reason={report.scoreReason ?? ""}
                  />
                  <div className="pb-2">
                    <div className="text-sm text-muted-foreground">de 100</div>
                    <div className={`font-semibold ${scoreColor(current.health_score)}`}>
                      {scoreLabel(current.health_score)}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Clique na nota para ver a composição.
                </p>
                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${current.health_score}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Finance */}
            <Card>
              <CardHeader>
                <CardTitle>💰 Resultado Atual</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Stat label="Receita estimada" value={BRL.format(report.finance.revenue)} />
                <Stat label="Custos totais" value={BRL.format(report.finance.costs)} />
                <Stat
                  label="Lucro estimado"
                  value={BRL.format(report.finance.profit)}
                  tone={report.finance.profit < 0 ? "neg" : "pos"}
                />
                <Stat
                  label="Lucro por hectare"
                  value={BRL.format(report.finance.profitPerHa)}
                  tone={report.finance.profitPerHa < 0 ? "neg" : "pos"}
                />
              </CardContent>
            </Card>

            {/* Risks & Opportunities */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    ⚠️ Principais Riscos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {report.risks.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    🚜 Principais Oportunidades
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {report.opportunities.map((o, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{o}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Indicators */}
            <Card>
              <CardHeader>
                <CardTitle>📊 Indicadores-Chave</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Stat label="Cultura mais lucrativa" value={report.indicators.mostProfitableCrop} />
                <Stat label="Cultura menos lucrativa" value={report.indicators.leastProfitableCrop} />
                <Stat label="Talhão mais eficiente" value={report.indicators.mostEfficientField} />
                <Stat label="Talhão menos eficiente" value={report.indicators.leastEfficientField} />
                <Stat
                  label="Dependência da maior cultura"
                  value={`${Math.round(report.indicators.singleCropDependencyPct)}%`}
                  tone={report.indicators.singleCropDependencyPct >= 70 ? "neg" : undefined}
                />
              </CardContent>
            </Card>

            {/* Action plan */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  ✅ Plano de Ação
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {report.actionPlan.map((a, i) => (
                    <li key={i} className="flex gap-3 rounded-md border bg-card p-3 text-sm">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>

          {/* History sidebar */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Histórico</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {history.map((d) => {
                const active = d.id === current.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      active ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <span>
                      {new Date(d.created_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className={`font-bold ${scoreColor(d.health_score)}`}>
                      {d.health_score}
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold ${
          tone === "neg" ? "text-destructive" : tone === "pos" ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// re-export so tree-shaking keeps icon used
void CheckCircle2;

function ScoreWithBreakdown({
  score,
  breakdown,
  reason,
}: {
  score: number;
  breakdown: { label: string; points: number }[];
  reason?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const triggerClass = `text-6xl font-bold ${scoreColor(score)} underline-offset-4 focus:outline-none`;

  // SSR-safe: render plain number until hydrated, then upgrade to interactive Popover.
  if (!mounted) {
    return <div className={triggerClass}>{score}</div>;
  }

  const positives = breakdown.filter((b) => (b?.points ?? 0) > 0);
  const penalties = breakdown.filter((b) => (b?.points ?? 0) < 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${triggerClass} cursor-pointer hover:underline`}
          title="Ver composição da nota"
        >
          {score}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-96 overflow-y-auto">
        <div className="mb-3 text-sm font-semibold">Composição da nota</div>
        {breakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Composição ainda não disponível.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
                Pontos positivos
              </div>
              {positives.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum bônus aplicado.</p>
              ) : (
                <ul className="space-y-1">
                  {positives.map((b, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="font-mono font-semibold text-primary">+{b.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">
                Penalidades
              </div>
              {penalties.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma penalidade aplicada.</p>
              ) : (
                <ul className="space-y-1">
                  {penalties.map((b, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="font-mono font-semibold text-destructive">{b.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span>Total</span>
              <span className="font-mono">{score}/100</span>
            </div>
            <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              <div className="mb-1 font-semibold text-foreground">Fórmula</div>
              Base 100 + bônus − penalidades, limitado entre 0 e 100. Cálculo determinístico:
              mesmos dados → mesma nota.
            </div>
            {reason && (
              <div className="rounded-md border bg-card p-2 text-xs">
                <div className="mb-1 font-semibold">Motivo da nota</div>
                <p className="text-muted-foreground">{reason}</p>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}