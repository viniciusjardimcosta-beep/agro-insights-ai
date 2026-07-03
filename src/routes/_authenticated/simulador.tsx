import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  FlaskConical,
  RotateCcw,
  Save,
  Sparkles,
  Sun,
  TrendingDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { aggregateFarm, BRL, NUM, type CostRow, type FieldRow, type PriceRow } from "@/lib/calc";
import { getFarmSnapshot } from "@/lib/data.functions";
import { computeMetrics, computeScoreBreakdown, type ScoreBreakdownEntry } from "@/lib/score";
import {
  createScenario,
  deleteScenario,
  listScenarios,
  type SimulatedScenarioRow,
} from "@/lib/scenarios.functions";

export const Route = createFileRoute("/_authenticated/simulador")({
  head: () => ({ meta: [{ title: "Simulador — AgroIntel AI" }] }),
  component: SimuladorPage,
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Erro: {error.message}
    </div>
  ),
});

const snapshotQuery = queryOptions({
  queryKey: ["farm-snapshot"],
  queryFn: () => getFarmSnapshot(),
});
const scenariosQuery = queryOptions({
  queryKey: ["scenarios"],
  queryFn: () => listScenarios(),
});

// Editable per-field overrides used only in memory. Never sent back to the
// real fields/costs/prices tables.
type FieldEdit = {
  id: string;
  name: string;
  crop: string;
  area: number;
  yieldBag: number;
  costPerHa: number;
  price: number;
};

function buildEdits(
  fields: FieldRow[],
  costs: CostRow[],
  prices: PriceRow[],
): FieldEdit[] {
  // Latest price per crop
  const sortedPrices = [...prices].sort((a, b) => (a.date < b.date ? 1 : -1));
  const priceByCrop: Record<string, number> = {};
  for (const p of sortedPrices)
    if (!(p.crop in priceByCrop)) priceByCrop[p.crop] = Number(p.price_per_bag);
  return fields.map((f) => {
    const area = Number(f.area || 0);
    const totalCost = costs
      .filter((c) => c.field_id === f.id)
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    return {
      id: f.id,
      name: f.name,
      crop: f.crop,
      area,
      yieldBag: Number(f.real_yield ?? f.estimated_yield ?? 0),
      costPerHa: area > 0 ? totalCost / area : 0,
      price: priceByCrop[f.crop] ?? 0,
    };
  });
}

function editsToRows(edits: FieldEdit[]) {
  // Convert edits back into calc-compatible fields/costs/prices so we can reuse
  // aggregateFarm without any changes. All in memory.
  const fields: FieldRow[] = edits.map((e) => ({
    id: e.id,
    name: e.name,
    crop: e.crop,
    area: e.area,
    estimated_yield: e.yieldBag,
    real_yield: null,
  }));
  const costs: CostRow[] = edits.map((e) => ({
    field_id: e.id,
    category: "Simulação",
    amount: e.area * e.costPerHa,
  }));
  // Give each crop its own price (use today's date), latest wins.
  const seen = new Set<string>();
  const prices: PriceRow[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const e of edits) {
    if (seen.has(e.crop)) continue;
    seen.add(e.crop);
    prices.push({ crop: e.crop, price_per_bag: e.price, date: today });
  }
  return { fields, costs, prices };
}

function SimuladorPage() {
  const { data, isLoading } = useQuery(snapshotQuery);
  const { data: scenarios = [] } = useQuery(scenariosQuery);
  const qc = useQueryClient();
  const createFn = useServerFn(createScenario);
  const deleteFn = useServerFn(deleteScenario);

  const realFields = (data?.fields ?? []) as FieldRow[];
  const realCosts = (data?.costs ?? []) as CostRow[];
  const realPrices = (data?.prices ?? []) as PriceRow[];
  const propertyId = (data?.properties?.[0]?.id as string | undefined) ?? null;

  const baseEdits = useMemo(
    () => buildEdits(realFields, realCosts, realPrices),
    [realFields, realCosts, realPrices],
  );
  const [edits, setEdits] = useState<FieldEdit[]>([]);
  const [scenarioName, setScenarioName] = useState("Cenário simulado");

  useEffect(() => {
    // Initialize on first load; on later refetches (window focus, save
    // invalidations, etc.) preserve any values the user has already edited
    // and only merge in new/removed fields. Without this, react-query
    // refetches would wipe the simulation and every metric would snap back
    // to the real snapshot, making the UI appear frozen.
    setEdits((prev) => {
      if (prev.length === 0) return baseEdits;
      const prevById = new Map(prev.map((e) => [e.id, e]));
      return baseEdits.map((b) => prevById.get(b.id) ?? b);
    });
  }, [baseEdits]);

  // Real (current) farm — NEVER mutated by the simulation.
  const realFarm = useMemo(
    () => aggregateFarm(realFields, realCosts, realPrices),
    [realFields, realCosts, realPrices],
  );
  const realScore = useMemo(() => computeScoreBreakdown(realFarm), [realFarm]);
  const realMetrics = useMemo(() => computeMetrics(realFarm), [realFarm]);

  // Simulated farm — computed from in-memory edits.
  const simRows = useMemo(() => editsToRows(edits), [edits]);
  const simFarm = useMemo(
    () => aggregateFarm(simRows.fields, simRows.costs, simRows.prices),
    [simRows],
  );
  const simScore = useMemo(() => computeScoreBreakdown(simFarm), [simFarm]);
  const simMetrics = useMemo(() => computeMetrics(simFarm), [simFarm]);

  const scoreDelta = simScore.score - realScore.score;

  function patch(id: string, key: keyof FieldEdit, value: number) {
    setEdits((prev) => prev.map((e) => (e.id === id ? { ...e, [key]: value } : e)));
  }

  function reset() {
    setEdits(baseEdits);
  }
  function applyPreset(preset: "otimista" | "conservador" | "pessimista") {
    const rules = {
      otimista: { price: 1.1, yield: 1.1 },
      conservador: { price: 0.9, yield: 0.95 },
      pessimista: { price: 0.8, yield: 0.85 },
    }[preset];
    setEdits(baseEdits.map((e) => ({
      ...e,
      price: +(e.price * rules.price).toFixed(2),
      yieldBag: +(e.yieldBag * rules.yield).toFixed(2),
    })));
  }

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: scenarioName.trim() || "Cenário simulado",
          property_id: propertyId,
          scenario_data: { edits: edits as unknown as Record<string, unknown>[] } as never,
          metrics_snapshot: simMetrics as unknown as Record<string, unknown>,
          score_breakdown: simScore.breakdown,
          simulated_score: simScore.score,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["scenarios"] });
      toast.success("Cenário salvo!");
    },
    onError: (e) => toast.error("Erro ao salvar", { description: (e as Error).message }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["scenarios"] });
      toast.success("Cenário excluído.");
    },
    onError: (e) => toast.error("Erro ao excluir", { description: (e as Error).message }),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando dados da fazenda...</p>;
  }

  if (realFields.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <FlaskConical className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-lg font-semibold">Sem talhões para simular</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre talhões, custos e preços para poder rodar simulações.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Simulador de Cenários</h1>
        <p className="text-sm text-muted-foreground">
          Teste mudanças em preço, produtividade, área e custo por hectare sem alterar os
          dados reais da fazenda. Nada é salvo no banco a não ser que você clique em
          <strong> Salvar Cenário</strong>.
        </p>
      </div>

      {/* Cenário Atual x Simulado */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ScenarioCard
          title="Cenário Atual"
          tone="muted"
          score={realScore.score}
          revenue={realFarm.totalRevenue}
          cost={realFarm.totalCost}
          profit={realFarm.totalProfit}
          margin={realMetrics.margin}
          depPct={realMetrics.depPct}
          breakevenByCrop={realMetrics.breakevenByCrop}
        />
        <ScenarioCard
          title="Cenário Simulado"
          tone={scoreDelta >= 0 ? "pos" : "neg"}
          score={simScore.score}
          revenue={simFarm.totalRevenue}
          cost={simFarm.totalCost}
          profit={simFarm.totalProfit}
          margin={simMetrics.margin}
          depPct={simMetrics.depPct}
          breakevenByCrop={simMetrics.breakevenByCrop}
        />
      </div>

      {/* Impacto */}
      <Card>
        <CardHeader>
          <CardTitle>📈 Impacto da Simulação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Impact label="Receita" prev={realFarm.totalRevenue} next={simFarm.totalRevenue} money />
          <Impact label="Custos" prev={realFarm.totalCost} next={simFarm.totalCost} money invert />
          <Impact label="Lucro" prev={realFarm.totalProfit} next={simFarm.totalProfit} money />
          <Impact
            label="Nota"
            prev={realScore.score}
            next={simScore.score}
            suffix=" pts"
            digits={0}
          />
        </CardContent>
      </Card>

      {/* Controles */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>🎛️ Controles de Simulação</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => applyPreset("otimista")}>
              <Sun className="mr-1 h-4 w-4" /> Otimista
            </Button>
            <Button size="sm" variant="outline" onClick={() => applyPreset("conservador")}>
              <Sparkles className="mr-1 h-4 w-4" /> Conservador
            </Button>
            <Button size="sm" variant="outline" onClick={() => applyPreset("pessimista")}>
              <TrendingDown className="mr-1 h-4 w-4" /> Pessimista
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              <RotateCcw className="mr-1 h-4 w-4" /> Resetar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-2">Talhão</th>
                  <th className="py-2 pr-2">Cultura</th>
                  <th className="py-2 pr-2">Área (ha)</th>
                  <th className="py-2 pr-2">Produtividade (sc/ha)</th>
                  <th className="py-2 pr-2">Custo/ha (R$)</th>
                  <th className="py-2 pr-2">Preço saca (R$)</th>
                </tr>
              </thead>
              <tbody>
                {edits.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-2 pr-2 font-medium">{e.name}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{e.crop}</td>
                    <td className="py-2 pr-2">
                      <NumInput value={e.area} onChange={(v) => patch(e.id, "area", v)} />
                    </td>
                    <td className="py-2 pr-2">
                      <NumInput value={e.yieldBag} onChange={(v) => patch(e.id, "yieldBag", v)} />
                    </td>
                    <td className="py-2 pr-2">
                      <NumInput value={e.costPerHa} onChange={(v) => patch(e.id, "costPerHa", v)} />
                    </td>
                    <td className="py-2 pr-2">
                      <NumInput value={e.price} onChange={(v) => patch(e.id, "price", v)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Explicação da variação da nota */}
      <Card>
        <CardHeader>
          <CardTitle>🧮 Explicação da Variação da Nota</CardTitle>
        </CardHeader>
        <CardContent>
          <BreakdownDiff
            prev={realScore.breakdown}
            next={simScore.breakdown}
            prevScore={realScore.score}
            nextScore={simScore.score}
          />
        </CardContent>
      </Card>

      {/* Salvar */}
      <Card>
        <CardHeader>
          <CardTitle>💾 Salvar Cenário</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder="Nome do cenário"
            className="sm:max-w-xs"
          />
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {createMut.isPending ? "Salvando..." : "Salvar Cenário"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Isso salva apenas uma fotografia da simulação. Seus dados reais permanecem
            intactos.
          </p>
        </CardContent>
      </Card>

      {/* Histórico */}
      <Card>
        <CardHeader>
          <CardTitle>📚 Histórico de Cenários</CardTitle>
        </CardHeader>
        <CardContent>
          {scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum cenário salvo ainda.</p>
          ) : (
            <ul className="divide-y">
              {scenarios.map((s) => (
                <ScenarioHistoryRow
                  key={s.id}
                  row={s}
                  currentRealScore={realScore.score}
                  onDelete={() => deleteMut.mutate(s.id)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScenarioCard({
  title,
  tone,
  score,
  revenue,
  cost,
  profit,
  margin,
  depPct,
  breakevenByCrop,
}: {
  title: string;
  tone: "muted" | "pos" | "neg";
  score: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  depPct: number;
  breakevenByCrop: Record<string, number>;
}) {
  const scoreCls =
    tone === "pos"
      ? "text-primary"
      : tone === "neg"
        ? "text-destructive"
        : "text-foreground";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Nota</div>
            <div className={`text-4xl font-bold ${scoreCls}`}>{score}/100</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Margem líquida</div>
            <div className="text-lg font-semibold">{margin.toFixed(1)}%</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Receita" value={BRL.format(revenue)} />
          <Stat label="Custos" value={BRL.format(cost)} />
          <Stat
            label="Lucro"
            value={BRL.format(profit)}
            tone={profit < 0 ? "neg" : "pos"}
          />
          <Stat label="Dep. principal cultura" value={`${depPct.toFixed(1)}%`} />
        </div>
        {Object.keys(breakevenByCrop).length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Ponto de equilíbrio (sc/ha)
            </div>
            <ul className="space-y-0.5 text-xs">
              {Object.entries(breakevenByCrop).map(([c, v]) => (
                <li key={c} className="flex justify-between">
                  <span className="text-muted-foreground">{c}</span>
                  <span className="font-mono">{NUM.format(v)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
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
        className={`text-base font-semibold ${
          tone === "neg" ? "text-destructive" : tone === "pos" ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Impact({
  label,
  prev,
  next,
  money,
  invert,
  suffix = "",
  digits = 2,
}: {
  label: string;
  prev: number;
  next: number;
  money?: boolean;
  invert?: boolean;
  suffix?: string;
  digits?: number;
}) {
  const delta = next - prev;
  const better = invert ? delta < 0 : delta > 0;
  const worse = invert ? delta > 0 : delta < 0;
  const fmt = (n: number) =>
    money ? BRL.format(n) : `${n.toLocaleString("pt-BR", { maximumFractionDigits: digits })}${suffix}`;
  const deltaFmt = money
    ? `${delta >= 0 ? "+" : ""}${BRL.format(delta)}`
    : `${delta >= 0 ? "+" : ""}${delta.toLocaleString("pt-BR", { maximumFractionDigits: digits })}${suffix}`;
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm">
        <span className="text-muted-foreground">{fmt(prev)}</span>
        {" → "}
        <span
          className={
            better ? "text-primary" : worse ? "text-destructive" : "font-semibold"
          }
        >
          {fmt(next)}
        </span>
      </div>
      <div
        className={`mt-1 text-xs font-semibold ${
          better ? "text-primary" : worse ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {deltaFmt}
      </div>
    </div>
  );
}

// --- Score breakdown diff ---

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
  if (label.startsWith("Custo elevado")) return { key: "custo_alto", display: "Custo elevado (>70% receita)" };
  if (label.startsWith("Talhões com lucro negativo"))
    return { key: "neg_fields", display: "Talhões com lucro negativo" };
  if (label.startsWith("Custo/ha")) return { key: "custo_ha", display: "Custo/ha acima da média" };
  if (label.startsWith("Ponto de equilíbrio") && !label.includes("confortável"))
    return { key: "breakeven", display: "Ponto de equilíbrio dos talhões" };
  if (label.startsWith("Ponto de equilíbrio confortável"))
    return { key: "be_confort", display: "Ponto de equilíbrio confortável em todos os talhões" };
  if (label.startsWith("Todos os talhões lucrativos"))
    return { key: "all_profit", display: "Todos os talhões lucrativos" };
  if (label.startsWith("Falta de preço"))
    return { key: "missing_price", display: "Falta de preço cadastrado" };
  if (label.startsWith("Falta de custo"))
    return { key: "missing_cost", display: "Falta de custo cadastrado" };
  return { key: `outro:${label}`, display: label };
}

function extractValue(label: string): string | null {
  const pctMatch = label.match(/(-?\d+[.,]?\d*)\s*%/);
  if (pctMatch) return `${pctMatch[1].replace(",", ".")}%`;
  return null;
}

type DiffRow = {
  key: string;
  display: string;
  prevPts: number;
  nextPts: number;
  impact: number;
  before: string | null;
  after: string | null;
};

function diffBreakdowns(prev: ScoreBreakdownEntry[], next: ScoreBreakdownEntry[]): DiffRow[] {
  const byKey = new Map<string, DiffRow>();
  for (const b of prev) {
    const r = ruleKey(b.label);
    if (!r) continue;
    const row = byKey.get(r.key) ?? {
      key: r.key,
      display: r.display,
      prevPts: 0,
      nextPts: 0,
      impact: 0,
      before: null,
      after: null,
    };
    row.prevPts += Number(b.points) || 0;
    row.before = extractValue(b.label) ?? row.before;
    byKey.set(r.key, row);
  }
  for (const b of next) {
    const r = ruleKey(b.label);
    if (!r) continue;
    const row = byKey.get(r.key) ?? {
      key: r.key,
      display: r.display,
      prevPts: 0,
      nextPts: 0,
      impact: 0,
      before: null,
      after: null,
    };
    row.nextPts += Number(b.points) || 0;
    row.after = extractValue(b.label) ?? row.after;
    row.display = r.display;
    byKey.set(r.key, row);
  }
  const rows = Array.from(byKey.values())
    .map((r) => ({ ...r, impact: r.nextPts - r.prevPts }))
    .filter((r) => r.impact !== 0 || r.prevPts !== r.nextPts);
  rows.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return rows;
}

function BreakdownDiff({
  prev,
  next,
  prevScore,
  nextScore,
}: {
  prev: ScoreBreakdownEntry[];
  next: ScoreBreakdownEntry[];
  prevScore: number;
  nextScore: number;
}) {
  const rows = diffBreakdowns(prev, next);
  const gains = rows.filter((r) => r.impact > 0);
  const losses = rows.filter((r) => r.impact < 0);
  const totalImpact = rows.reduce((s, r) => s + r.impact, 0);
  const delta = nextScore - prevScore;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma regra da nota foi afetada pela simulação atual.
      </p>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <DiffSection title="Ganhos e bônus" rows={gains} positive />
      <DiffSection title="Penalidades novas ou piores" rows={losses} positive={false} />
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Soma dos impactos por regra</span>
        <span
          className={`font-mono font-semibold ${
            totalImpact > 0 ? "text-primary" : totalImpact < 0 ? "text-destructive" : ""
          }`}
        >
          {totalImpact > 0 ? `+${totalImpact}` : totalImpact} pts
        </span>
      </div>
      {totalImpact !== delta && (
        <p className="text-[11px] text-muted-foreground">
          Diferença para a variação total ({delta > 0 ? "+" : ""}
          {delta}) decorre do ajuste de teto/piso da nota (0–100).
        </p>
      )}
    </div>
  );
}

function DiffSection({
  title,
  rows,
  positive,
}: {
  title: string;
  rows: DiffRow[];
  positive: boolean;
}) {
  return (
    <div>
      <div
        className={`mb-2 text-xs font-semibold uppercase tracking-wide ${
          positive ? "text-primary" : "text-destructive"
        }`}
      >
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nada nesta categoria.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li
              key={r.key}
              className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-md border px-3 py-2 ${
                positive
                  ? "border-primary/20 bg-primary/5"
                  : "border-destructive/20 bg-destructive/5"
              }`}
            >
              <span>{r.display}</span>
              <span className="text-right font-mono text-xs">
                {r.before || r.after ? (
                  <>
                    <span className="text-muted-foreground">{r.before ?? "—"}</span>
                    {" → "}
                    <span className={positive ? "text-primary" : "text-destructive"}>
                      {r.after ?? "—"}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {r.prevPts} → {r.nextPts} pts
                  </span>
                )}
              </span>
              <span
                className={`text-right font-mono font-semibold ${
                  positive ? "text-primary" : "text-destructive"
                }`}
              >
                {r.impact > 0 ? `+${r.impact}` : r.impact}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NumInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="0.01"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className="h-8 w-28 text-sm"
    />
  );
}

function ScenarioHistoryRow({
  row,
  currentRealScore,
  onDelete,
}: {
  row: SimulatedScenarioRow;
  currentRealScore: number;
  onDelete: () => void;
}) {
  const diff = row.simulated_score - currentRealScore;
  return (
    <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted-foreground">
          {new Date(row.created_at).toLocaleString("pt-BR")}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Nota simulada</div>
          <div className="font-bold">{row.simulated_score}/100</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">vs. diagnóstico atual</div>
          <div
            className={`font-mono text-sm font-semibold ${
              diff > 0 ? "text-primary" : diff < 0 ? "text-destructive" : ""
            }`}
          >
            {diff > 0 ? `+${diff}` : diff} pts
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Excluir cenário">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </li>
  );
}