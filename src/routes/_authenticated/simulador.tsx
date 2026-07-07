import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  FlaskConical,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  RotateCcw,
  Save,
  Sparkles,
  Sun,
  TrendingDown,
  Trash2,
  Trophy,
  GitCompare,
  Upload,
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
  const [cmpA, setCmpA] = useState<string>("");
  const [cmpB, setCmpB] = useState<string>("");

  useEffect(() => {
    if (scenarios.length >= 2) {
      setCmpA((prev) => (prev && scenarios.some((s) => s.id === prev) ? prev : scenarios[0].id));
      setCmpB((prev) => (prev && scenarios.some((s) => s.id === prev) ? prev : scenarios[1].id));
    }
  }, [scenarios]);

  function loadScenarioAsBase(row: SimulatedScenarioRow) {
    const raw = (row.scenario_data as { edits?: unknown })?.edits;
    if (!Array.isArray(raw) || raw.length === 0) {
      toast.error("Cenário sem dados editáveis para carregar.");
      return;
    }
    const loaded = raw as FieldEdit[];
    // Merge with current baseEdits so any newly added real fields still appear.
    const byId = new Map(loaded.map((e) => [e.id, e]));
    const merged = baseEdits.map((b) => {
      const found = byId.get(b.id);
      return found ? { ...b, ...found } : b;
    });
    // Also include cenário-only fields (in case a field was later deleted).
    for (const e of loaded) if (!merged.some((m) => m.id === e.id)) merged.push(e);
    setEdits(merged);
    setScenarioName(`${row.name} (editando)`);
    toast.success(`Cenário "${row.name}" carregado para edição.`);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
          <Impact label="Receita" prev={realFarm.totalRevenue} next={simFarm.totalRevenue} format="money" />
          <Impact label="Custos" prev={realFarm.totalCost} next={simFarm.totalCost} format="money" invert />
          <Impact label="Lucro" prev={realFarm.totalProfit} next={simFarm.totalProfit} format="money" />
          <Impact
            label="Nota"
            prev={realScore.score}
            next={simScore.score}
            format="points"
            showPct={false}
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
                  onUseAsBase={() => loadScenarioAsBase(s)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Comparar cenários salvos */}
      {scenarios.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" /> Comparar Cenários Salvos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ScenarioPicker
                label="Cenário A"
                value={cmpA}
                onChange={setCmpA}
                scenarios={scenarios}
              />
              <ScenarioPicker
                label="Cenário B"
                value={cmpB}
                onChange={setCmpB}
                scenarios={scenarios}
              />
            </div>
            <ScenarioCompare
              a={scenarios.find((s) => s.id === cmpA)}
              b={scenarios.find((s) => s.id === cmpB)}
              onUseAsBase={loadScenarioAsBase}
            />
          </CardContent>
        </Card>
      )}
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
  format,
  invert,
  showPct = true,
}: {
  label: string;
  prev: number;
  next: number;
  format: "money" | "points";
  invert?: boolean;
  showPct?: boolean;
}) {
  const delta = next - prev;
  const eps = format === "points" ? 0.5 : 0.005;
  const dir: "up" | "down" | "flat" =
    delta > eps ? "up" : delta < -eps ? "down" : "flat";
  const better =
    dir === "flat" ? false : invert ? dir === "down" : dir === "up";
  const worse =
    dir === "flat" ? false : invert ? dir === "up" : dir === "down";
  const tone = better
    ? "text-emerald-600 dark:text-emerald-400"
    : worse
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";
  const borderTone = better
    ? "border-emerald-500/30 bg-emerald-500/5"
    : worse
      ? "border-red-500/30 bg-red-500/5"
      : "border-border bg-muted/30";

  const fmtValue = (n: number) =>
    format === "money"
      ? BRL.format(n)
      : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} pts`;

  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const absDelta = Math.abs(delta);
  const deltaValueFmt =
    format === "money"
      ? `${sign}${BRL.format(absDelta)}`
      : `${sign}${absDelta.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} pts`;

  const pctText = (() => {
    if (!showPct) return null;
    if (prev === 0) return delta === 0 ? "0,0%" : "—";
    const pct = (delta / Math.abs(prev)) * 100;
    const pSign = pct > 0 ? "+" : pct < 0 ? "−" : "";
    return `${pSign}${Math.abs(pct).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`;
  })();

  const Arrow =
    dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  return (
    <div className={`rounded-lg border p-3 transition ${borderTone}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm tabular-nums">
        <span className="text-muted-foreground">{fmtValue(prev)}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={`font-semibold ${dir === "flat" ? "text-foreground" : tone}`}>
          {fmtValue(next)}
        </span>
      </div>
      <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold tabular-nums ${tone}`}>
        <Arrow className="h-3.5 w-3.5 shrink-0" />
        <span>{dir === "flat" ? "Sem alteração" : deltaValueFmt}</span>
        {pctText && dir !== "flat" && (
          <span className="opacity-80">({pctText})</span>
        )}
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
      {gains.length > 0 && <DiffSection title="Ganhos e bônus" rows={gains} positive />}
      {losses.length > 0 && (
        <DiffSection title="Penalidades" rows={losses} positive={false} />
      )}
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-sm font-semibold">Total de impacto</span>
        <span
          className={`font-mono text-base font-bold ${
            totalImpact > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : totalImpact < 0
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
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
  const toneText = positive
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
  const toneBorder = positive
    ? "border-emerald-500/30 bg-emerald-500/5"
    : "border-red-500/30 bg-red-500/5";
  return (
    <div>
      <div
        className={`mb-2 text-xs font-semibold uppercase tracking-wide ${toneText}`}
      >
        {title}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const hasValues = Boolean(r.before || r.after);
          return (
            <li
              key={r.key}
              className={`flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${toneBorder}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{r.display}</div>
                {hasValues ? (
                  <div className="mt-1 flex items-center gap-2 font-mono text-xs">
                    <span className="text-muted-foreground">{r.before ?? "—"}</span>
                    <span className="text-muted-foreground">↓</span>
                    <span className={toneText}>{r.after ?? "—"}</span>
                  </div>
                ) : (
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {r.prevPts} pts ↓ {r.nextPts} pts
                  </div>
                )}
              </div>
              <div className="flex items-baseline gap-1 sm:flex-col sm:items-end sm:gap-0">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Impacto
                </span>
                <span className={`font-mono text-sm font-semibold ${toneText}`}>
                  {r.impact > 0 ? `+${r.impact}` : r.impact} pts
                </span>
              </div>
            </li>
          );
        })}
      </ul>
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
  onUseAsBase,
}: {
  row: SimulatedScenarioRow;
  currentRealScore: number;
  onDelete: () => void;
  onUseAsBase: () => void;
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
        <Button size="sm" variant="outline" onClick={onUseAsBase} title="Carregar para edição">
          <Upload className="mr-1 h-4 w-4" /> Usar como base
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Excluir cenário">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </li>
  );
}

// --- Compare two saved scenarios ---

function ScenarioPicker({
  label,
  value,
  onChange,
  scenarios,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  scenarios: SimulatedScenarioRow[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} — {s.simulated_score}/100 · {new Date(s.created_at).toLocaleDateString("pt-BR")}
          </option>
        ))}
      </select>
    </label>
  );
}

type ScenarioMetricsView = {
  score: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  breakevenByCrop: Record<string, number>;
};

function extractView(row: SimulatedScenarioRow): ScenarioMetricsView {
  const m = (row.metrics_snapshot ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const be = (m.breakevenByCrop ?? {}) as Record<string, number>;
  return {
    score: row.simulated_score,
    revenue: num(m.revenue),
    cost: num(m.costs),
    profit: num(m.profit),
    margin: num(m.margin),
    breakevenByCrop: Object.fromEntries(
      Object.entries(be).map(([k, v]) => [k, Number(v) || 0]),
    ),
  };
}

function ScenarioCompare({
  a,
  b,
  onUseAsBase,
}: {
  a?: SimulatedScenarioRow;
  b?: SimulatedScenarioRow;
  onUseAsBase: (row: SimulatedScenarioRow) => void;
}) {
  if (!a || !b) {
    return <p className="text-sm text-muted-foreground">Selecione dois cenários.</p>;
  }
  if (a.id === b.id) {
    return (
      <p className="text-sm text-muted-foreground">
        Escolha dois cenários diferentes para comparar.
      </p>
    );
  }
  const va = extractView(a);
  const vb = extractView(b);

  // Winner rules: higher score, higher profit, lower cost, better (higher) margin.
  const winners = {
    score: va.score === vb.score ? "tie" : va.score > vb.score ? "a" : "b",
    profit: va.profit === vb.profit ? "tie" : va.profit > vb.profit ? "a" : "b",
    cost: va.cost === vb.cost ? "tie" : va.cost < vb.cost ? "a" : "b",
    margin: va.margin === vb.margin ? "tie" : va.margin > vb.margin ? "a" : "b",
  } as const;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <CompareColumn row={a} view={va} winners={winners} side="a" onUseAsBase={onUseAsBase} />
        <CompareColumn row={b} view={vb} winners={winners} side="b" onUseAsBase={onUseAsBase} />
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Diferenças (B em relação a A)
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Impact label="Nota" prev={va.score} next={vb.score} format="points" showPct={false} />
          <Impact label="Receita" prev={va.revenue} next={vb.revenue} format="money" />
          <Impact label="Custos" prev={va.cost} next={vb.cost} format="money" invert />
          <Impact label="Lucro" prev={va.profit} next={vb.profit} format="money" />
          <MarginImpact prev={va.margin} next={vb.margin} />
        </div>
      </div>
    </div>
  );
}

function CompareColumn({
  row,
  view,
  winners,
  side,
  onUseAsBase,
}: {
  row: SimulatedScenarioRow;
  view: ScenarioMetricsView;
  winners: { score: string; profit: string; cost: string; margin: string };
  side: "a" | "b";
  onUseAsBase: (row: SimulatedScenarioRow) => void;
}) {
  const badge = (won: boolean) =>
    won ? (
      <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
        <Trophy className="h-3 w-3" /> melhor
      </span>
    ) : null;
  const topRules = [...row.score_breakdown]
    .filter((r) => r.points !== 0 && !r.label.startsWith("Base") && !r.label.startsWith("Ajuste"))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 5);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="truncate">
            <span className="mr-2 text-xs text-muted-foreground">Cenário {side.toUpperCase()}</span>
            {row.name}
          </span>
          <Button size="sm" variant="outline" onClick={() => onUseAsBase(row)}>
            <Upload className="mr-1 h-4 w-4" /> Usar como base
          </Button>
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {new Date(row.created_at).toLocaleString("pt-BR")}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">
            Nota {badge(winners.score === side)}
          </div>
          <div className="text-3xl font-bold">{view.score}/100</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <CmpStat label="Receita" value={BRL.format(view.revenue)} />
          <CmpStat
            label={<>Custos {badge(winners.cost === side)}</>}
            value={BRL.format(view.cost)}
          />
          <CmpStat
            label={<>Lucro {badge(winners.profit === side)}</>}
            value={BRL.format(view.profit)}
            tone={view.profit < 0 ? "neg" : "pos"}
          />
          <CmpStat
            label={<>Margem {badge(winners.margin === side)}</>}
            value={`${view.margin.toFixed(1)}%`}
          />
        </div>
        {Object.keys(view.breakevenByCrop).length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Ponto de equilíbrio (sc/ha)
            </div>
            <ul className="space-y-0.5 text-xs">
              {Object.entries(view.breakevenByCrop).map(([c, v]) => (
                <li key={c} className="flex justify-between">
                  <span className="text-muted-foreground">{c}</span>
                  <span className="font-mono">{NUM.format(v)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {topRules.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Principais regras do score
            </div>
            <ul className="space-y-1 text-xs">
              {topRules.map((r, i) => (
                <li key={i} className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.label}>
                    {r.label}
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      r.points > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {r.points > 0 ? `+${r.points}` : r.points}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CmpStat({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div>
      <div className="flex items-center text-xs text-muted-foreground">{label}</div>
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

function MarginImpact({ prev, next }: { prev: number; next: number }) {
  const delta = next - prev;
  const eps = 0.05;
  const dir: "up" | "down" | "flat" =
    delta > eps ? "up" : delta < -eps ? "down" : "flat";
  const better = dir === "up";
  const worse = dir === "down";
  const tone = better
    ? "text-emerald-600 dark:text-emerald-400"
    : worse
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";
  const borderTone = better
    ? "border-emerald-500/30 bg-emerald-500/5"
    : worse
      ? "border-red-500/30 bg-red-500/5"
      : "border-border bg-muted/30";
  const Arrow =
    dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return (
    <div className={`rounded-lg border p-3 transition ${borderTone}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Margem
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm tabular-nums">
        <span className="text-muted-foreground">{prev.toFixed(1)}%</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={`font-semibold ${dir === "flat" ? "text-foreground" : tone}`}>
          {next.toFixed(1)}%
        </span>
      </div>
      <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold tabular-nums ${tone}`}>
        <Arrow className="h-3.5 w-3.5 shrink-0" />
        <span>
          {dir === "flat"
            ? "Sem alteração"
            : `${sign}${Math.abs(delta).toFixed(1)} pp`}
        </span>
      </div>
    </div>
  );
}