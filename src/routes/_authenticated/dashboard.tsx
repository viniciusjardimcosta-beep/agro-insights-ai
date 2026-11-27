import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Activity, AlertTriangle, Banknote, BarChart3, Coins, Database, MapPinned, Sparkles, Sprout, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFarmSnapshot } from "@/lib/data.functions";
import { latestDiagnostic } from "@/lib/diagnostics.functions";
import { seedDemoData } from "@/lib/demo.functions";
import { aggregateFarm, BRL, cropsMissingPrice, NUM } from "@/lib/calc";
import { ExecutiveReportButton } from "@/components/executive-report-button";
import { OnboardingCard } from "@/components/onboarding-card";
import { PecuariaInviteCard } from "@/components/pecuaria-invite-card";
import { RanchHome } from "@/components/ranch-home";
import { useFarm } from "@/lib/farm-selection";
import { areaOverruns, areaOverrunText } from "@/lib/farms";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — AgroIntel AI" }] }),
  component: Dashboard,
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Erro ao carregar painel: {(error as Error).message}
    </div>
  ),
});

const snapshotQuery = queryOptions({
  queryKey: ["farm-snapshot"],
  queryFn: () => getFarmSnapshot(),
});

const latestDiagnosticQuery = queryOptions({
  queryKey: ["latest-diagnostic"],
  queryFn: () => latestDiagnostic(),
});

function scoreColor(score: number) {
  if (score >= 75) return "text-primary";
  if (score >= 50) return "text-warning";
  return "text-destructive";
}

function Dashboard() {
  const { data, isLoading, error } = useQuery(snapshotQuery);
  const { data: latestDiag } = useQuery(latestDiagnosticQuery);
  const farmSel = useFarm();
  const qc = useQueryClient();
  const seed = useServerFn(seedDemoData);
  const [seeding, setSeeding] = useState(false);

  // Quem só cria gado vê o resumo do rebanho, não os números de lavoura.
  if (!farmSel.flags.lavoura) return <RanchHome />;
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando painel...</p>;
  if (error) return <p className="text-sm text-destructive">Erro ao carregar painel: {(error as Error).message}</p>;

  const snapshot = data ?? { fields: [], costs: [], prices: [], properties: [] };
  // Fazenda escolhida no topo: só os talhões dela e os custos desses talhões.
  const allFields = snapshot.fields as { id: string; property_id?: string }[];
  const shownFields = farmSel.selected ? allFields.filter((f) => f.property_id === farmSel.selected!.id) : allFields;
  const shownIds = new Set(shownFields.map((f) => f.id));
  const shownCosts = farmSel.selected ? (snapshot.costs as { field_id: string }[]).filter((c) => shownIds.has(c.field_id)) : snapshot.costs;
  // "Área das fazendas" = o que a pessoa cadastrou em Fazendas (inclui pasto). "Área plantada" = soma dos talhões.
  const farmsArea = ((snapshot.properties ?? []) as { id: string; total_area: number | string | null }[])
    .filter((p) => !farmSel.selected || p.id === farmSel.selected.id)
    .reduce((a, p) => a + Number(p.total_area ?? 0), 0);
  const farm = aggregateFarm(shownFields as never, shownCosts as never, snapshot.prices as never);

  async function loadDemo() {
    setSeeding(true);
    try {
      await seed();
      await qc.invalidateQueries();
      toast.success("Dados de demonstração carregados!");
    } catch (e) {
      toast.error("Erro ao carregar demo", { description: (e as Error).message });
    } finally {
      setSeeding(false);
    }
  }

  const isEmpty = snapshot.fields.length === 0;
  const farmHasNoFields = !isEmpty && shownFields.length === 0;
  const alerts: { tone: "warn" | "info"; text: string }[] = [];
  if (farm.totalArea > 0) {
    const noPrice = cropsMissingPrice(shownFields as never, farm.priceByCrop);
    if (noPrice.length > 0)
      alerts.push({
        tone: "warn",
        text: `Sem preço cadastrado para: ${noPrice.join(", ")}. A receita e o lucro desses talhões aparecem zerados — cadastre o preço em "Preços".`,
      });
    if (farm.profitPerHa < 0)
      alerts.push({ tone: "warn", text: `Atenção: lucro/ha negativo (${BRL.format(farm.profitPerHa)}). Reveja custos ou preços.` });
    const overruns = areaOverruns((snapshot.properties ?? []) as never[], shownFields as never[]).filter((o) => !farmSel.selected || o.id === farmSel.selected.id);
    for (const o of overruns) alerts.push({ tone: "warn", text: areaOverrunText(o, overruns.length > 1) });
    farm.perField.forEach((f) => {
      if (f.breakevenBagPerHa > 0 && f.yieldBag > 0 && f.breakevenBagPerHa > f.yieldBag * 0.9) {
        alerts.push({
          tone: "warn",
          text: `${f.field.name}: precisa colher ${NUM.format(f.breakevenBagPerHa)} sc/ha para empatar (yield estimado ${NUM.format(f.yieldBag)} sc/ha).`,
        });
      }
    });
  }

  const cards = [
    { label: farmSel.selected ? "Área da fazenda" : "Área das fazendas", value: `${NUM.format(farmsArea)} ha`, icon: MapPinned },
    { label: "Área plantada", value: `${NUM.format(farm.totalArea)} ha`, icon: Sprout },
    { label: "Custo total", value: BRL.format(farm.totalCost), icon: Banknote },
    { label: "Receita estimada", value: BRL.format(farm.totalRevenue), icon: TrendingUp },
    { label: "Lucro estimado", value: BRL.format(farm.totalProfit), icon: Coins, tone: farm.totalProfit < 0 ? "neg" : "pos" },
    { label: "Lucro por hectare", value: BRL.format(farm.profitPerHa), icon: BarChart3, tone: farm.profitPerHa < 0 ? "neg" : "pos" },
    { label: "Talhões", value: String(shownFields.length), icon: Sprout },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {farmSel.selected ? `Resumo financeiro de ${farmSel.selected.name}.` : "Resumo financeiro da sua safra."}
          </p>
        </div>
        {isEmpty && (
          <Button onClick={loadDemo} disabled={seeding} variant="outline" size="sm">
            <Database className="mr-2 h-4 w-4" />
            {seeding ? "Carregando..." : "Ver com dados de exemplo"}
          </Button>
        )}
        {!isEmpty && <ExecutiveReportButton />}
      </div>

      {isEmpty && <OnboardingCard />}

      {!isEmpty && <PecuariaInviteCard />}

      {farmHasNoFields && (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Esta fazenda ainda não tem talhões. <Link to="/talhoes" className="text-primary underline">Cadastre o talhão</Link> para ver os números dela aqui.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="shadow-[var(--shadow-card)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${c.tone === "neg" ? "text-destructive" : c.tone === "pos" ? "text-primary" : ""}`}>
                {c.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Diagnostic health card */}
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-primary" />
            Saúde Financeira
          </CardTitle>
          <Button asChild size="sm" variant={latestDiag ? "outline" : "default"}>
            <Link to="/diagnostico">
              <Sparkles className="mr-1 h-3 w-3" />
              {latestDiag ? "Ver diagnóstico" : "Gerar diagnóstico"}
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {latestDiag ? (
            <div className="flex items-end gap-3">
              <div className={`text-4xl font-bold ${scoreColor(latestDiag.health_score)}`}>
                {latestDiag.health_score}
              </div>
              <div className="pb-1 text-sm text-muted-foreground">
                / 100 · atualizado em{" "}
                {new Date(latestDiag.created_at).toLocaleDateString("pt-BR")}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Gere seu primeiro diagnóstico para ver a nota de saúde financeira da fazenda.
            </p>
          )}
        </CardContent>
      </Card>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      {isEmpty && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Sprout className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-lg font-semibold">Nada cadastrado ainda</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Comece cadastrando uma fazenda e seus talhões, ou carregue dados de demonstração.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}