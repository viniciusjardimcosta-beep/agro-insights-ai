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

            {/* Composição da Nota — visible section */}
            <Card>
              <CardHeader>
                <CardTitle>🧮 Composição da Nota</CardTitle>
              </CardHeader>
              <CardContent>
                <ScoreComposition
                  score={current.health_score}
                  breakdown={
                    Array.isArray(report.scoreBreakdown) ? report.scoreBreakdown : []
                  }
                  reason={report.scoreReason ?? ""}
                />
              </CardContent>
            </Card>

            {/* Evolução vs diagnóstico anterior */}
            <Card>
              <CardHeader>
                <CardTitle>📈 Evolução da Saúde Financeira</CardTitle>
              </CardHeader>
              <CardContent>
                <Evolution
                  current={current}
                  previous={
                    history[history.findIndex((d) => d.id === current.id) + 1] ?? null
                  }
                />
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

type DiagnosticRow = {
  id: string;
  created_at: string;
  health_score: number;
  report: DiagnosticReport | unknown;
};

function Evolution({
  current,
  previous,
}: {
  current: DiagnosticRow;
  previous: DiagnosticRow | null;
}) {
  if (!previous) {
    return (
      <p className="text-sm text-muted-foreground">
        Este é o primeiro diagnóstico. A evolução aparecerá quando você gerar um novo.
      </p>
    );
  }
  const cur = (current.report ?? {}) as DiagnosticReport;
  const prev = (previous.report ?? {}) as DiagnosticReport;
  const delta = current.health_score - previous.health_score;
  const positive = delta > 0;
  const negative = delta < 0;

  const curBd = Array.isArray(cur.scoreBreakdown) ? cur.scoreBreakdown : [];
  const prevBd = Array.isArray(prev.scoreBreakdown) ? prev.scoreBreakdown : [];

  // Group breakdown entries by a stable rule key so we can compute per-rule impact.
  function ruleKey(label: string): { key: string; display: string } | null {
    if (label === "Base inicial") return null;
    if (label.startsWith("Ajuste para")) return null;
    if (label.startsWith("Margem líquida")) return { key: "margem", display: "Margem líquida" };
    if (label.startsWith("Dependência da cultura")) {
      const m = label.match(/Dependência da cultura (\S+)/);
      return { key: `dep:${m?.[1] ?? ""}`, display: `Dependência de ${m?.[1] ?? "cultura"}` };
    }
    if (label.startsWith("Diferença de rentabilidade")) {
      const m = label.match(/Diferença de rentabilidade (\S+) vs (\S+)/);
      return {
        key: "spread",
        display: `Diferença de rentabilidade ${m?.[1] ?? ""} vs ${m?.[2] ?? ""}`.trim(),
      };
    }
    if (label.startsWith("Custo elevado")) return { key: "custo_alto", display: "Custo elevado por cultura (>70% receita)" };
    if (label.startsWith("Talhões com lucro negativo")) return { key: "neg_fields", display: "Talhões com lucro negativo" };
    if (label.startsWith("Custo/ha")) return { key: "custo_ha", display: "Custo/ha acima da média" };
    if (label.startsWith("Ponto de equilíbrio") && !label.includes("confortável"))
      return { key: "breakeven", display: "Ponto de equilíbrio dos talhões" };
    if (label.startsWith("Ponto de equilíbrio confortável"))
      return { key: "be_confort", display: "Ponto de equilíbrio confortável em todos os talhões" };
    if (label.startsWith("Todos os talhões lucrativos"))
      return { key: "all_profit", display: "Todos os talhões lucrativos" };
    if (label.startsWith("Falta de preço")) return { key: "missing_price", display: "Falta de preço cadastrado" };
    if (label.startsWith("Falta de custo")) return { key: "missing_cost", display: "Falta de custo cadastrado" };
    return { key: `outro:${label}`, display: label };
  }

  // Extract a human-readable value from a label (first percent or "X sc/ha")
  function extractValue(label: string): string | null {
    const pctMatch = label.match(/(-?\d+[.,]?\d*)\s*%/);
    if (pctMatch) return `${pctMatch[1].replace(",", ".")}%`;
    return null;
  }

  type Row = {
    key: string;
    display: string;
    prevPts: number;
    curPts: number;
    impact: number;
    before: string | null;
    after: string | null;
  };
  const byKey = new Map<string, Row>();
  for (const b of prevBd) {
    const r = ruleKey(b.label);
    if (!r) continue;
    const row = byKey.get(r.key) ?? {
      key: r.key,
      display: r.display,
      prevPts: 0,
      curPts: 0,
      impact: 0,
      before: null,
      after: null,
    };
    row.prevPts += Number(b.points) || 0;
    row.before = extractValue(b.label) ?? row.before;
    byKey.set(r.key, row);
  }
  for (const b of curBd) {
    const r = ruleKey(b.label);
    if (!r) continue;
    const row = byKey.get(r.key) ?? {
      key: r.key,
      display: r.display,
      prevPts: 0,
      curPts: 0,
      impact: 0,
      before: null,
      after: null,
    };
    row.curPts += Number(b.points) || 0;
    row.after = extractValue(b.label) ?? row.after;
    row.display = r.display;
    byKey.set(r.key, row);
  }
  const rows: Row[] = Array.from(byKey.values())
    .map((r) => ({ ...r, impact: r.curPts - r.prevPts }))
    .filter((r) => r.impact !== 0 || r.prevPts !== r.curPts);
  rows.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  const totalImpact = rows.reduce((s, r) => s + r.impact, 0);
  const hasAnyBreakdown = curBd.length > 0 || prevBd.length > 0;

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Nota anterior" value={String(previous.health_score)} />
        <Stat label="Nota atual" value={String(current.health_score)} />
        <Stat
          label="Variação"
          value={`${delta > 0 ? "+" : ""}${delta} pontos`}
          tone={positive ? "pos" : negative ? "neg" : undefined}
        />
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {positive
            ? "Principais causas da melhora"
            : negative
              ? "Principais causas da queda"
              : "Fatores que mudaram"}
        </div>
        {!hasAnyBreakdown ? (
          <p className="text-xs text-muted-foreground">
            Composição comparável indisponível para um dos diagnósticos.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum indicador relevante mudou entre os diagnósticos.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Indicador</span>
              <span className="text-right">Anterior → Atual</span>
              <span className="text-right">Impacto</span>
            </div>
            <ul className="mt-1 space-y-1">
              {rows.map((r) => {
                const better = r.impact > 0;
                const worse = r.impact < 0;
                return (
                  <li
                    key={r.key}
                    className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-md border px-3 py-2 ${
                      better
                        ? "border-primary/20 bg-primary/5"
                        : worse
                          ? "border-destructive/20 bg-destructive/5"
                          : "border-border bg-muted/30"
                    }`}
                  >
                    <span>{r.display}</span>
                    <span className="text-right font-mono text-xs">
                      {r.before || r.after ? (
                        <>
                          <span className="text-muted-foreground">{r.before ?? "—"}</span>
                          {" → "}
                          <span className={worse ? "text-destructive" : better ? "text-primary" : ""}>
                            {r.after ?? "—"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          {r.prevPts} → {r.curPts} pts
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-right font-mono font-semibold ${
                        better ? "text-primary" : worse ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {r.impact > 0 ? `+${r.impact}` : r.impact}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Soma dos impactos por regra
              </span>
              <span
                className={`font-mono font-semibold ${
                  totalImpact > 0 ? "text-primary" : totalImpact < 0 ? "text-destructive" : ""
                }`}
              >
                {totalImpact > 0 ? `+${totalImpact}` : totalImpact} pts
              </span>
            </div>
            {totalImpact !== delta && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Diferença para a variação total ({delta > 0 ? "+" : ""}
                {delta}) decorre do ajuste de teto/piso da nota (0–100).
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ScoreComposition({
  score,
  breakdown,
  reason,
}: {
  score: number;
  breakdown: { label: string; points: number }[];
  reason?: string;
}) {
  if (!breakdown || breakdown.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Composição ainda não disponível.</p>
    );
  }
  const base = breakdown.find((b) => b.label === "Base inicial");
  const positives = breakdown.filter(
    (b) => b.label !== "Base inicial" && (b?.points ?? 0) > 0,
  );
  const penalties = breakdown.filter((b) => (b?.points ?? 0) < 0);
  const sumPos = positives.reduce((s, b) => s + b.points, 0);
  const sumNeg = penalties.reduce((s, b) => s + b.points, 0);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-muted-foreground">Base</span>
        <span className="font-mono font-semibold">{base?.points ?? 100}</span>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">
          Penalidades
        </div>
        {penalties.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma penalidade aplicada.</p>
        ) : (
          <ul className="space-y-1">
            {penalties.map((b, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2"
              >
                <span>{b.label}</span>
                <span className="font-mono font-semibold text-destructive">{b.points}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
          Bônus
        </div>
        {positives.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum bônus aplicado.</p>
        ) : (
          <ul className="space-y-1">
            {positives.map((b, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2"
              >
                <span>{b.label}</span>
                <span className="font-mono font-semibold text-primary">
                  {b.label.startsWith("Ajuste") ? b.points : `+${b.points}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-semibold text-foreground">Cálculo</div>
        <div className="font-mono">
          {base?.points ?? 100} {sumNeg !== 0 ? sumNeg : ""}{" "}
          {sumPos !== 0 ? `+ ${sumPos}` : ""} = {(base?.points ?? 100) + sumNeg + sumPos}
          {(base?.points ?? 100) + sumNeg + sumPos !== score && (
            <> → limitado a {score}</>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border-2 border-primary/40 bg-primary/5 px-3 py-3">
        <span className="font-semibold">Resultado final</span>
        <span className={`font-mono text-2xl font-bold ${scoreColor(score)}`}>
          {score}/100
        </span>
      </div>

      {reason && (
        <div className="rounded-md border bg-card p-3 text-xs">
          <div className="mb-1 font-semibold">Motivo da nota</div>
          <p className="text-muted-foreground">{reason}</p>
        </div>
      )}
    </div>
  );
}

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