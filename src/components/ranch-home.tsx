import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Beef } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFarm } from "@/lib/farm-selection";
import { cattleOfFarm } from "@/lib/farms";
import { BRL, NUM } from "@/lib/calc";
import { listCattle } from "@/lib/cattle.functions";
import { summarizeFarm, summarizeStock, type CattleCost, type CattleLoss, type CattleSale, type Lot } from "@/lib/cattle";

const qCattle = queryOptions({ queryKey: ["cattle"], queryFn: () => listCattle() });

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Início de quem só cria gado: o resumo do rebanho no lugar dos números de lavoura. */
export function RanchHome() {
  const q = useQuery(qCattle);
  const farmSel = useFarm();
  const { lots, costs, sales, losses } = cattleOfFarm(
    { lots: (q.data?.lots ?? []) as Lot[], costs: (q.data?.costs ?? []) as CattleCost[], sales: (q.data?.sales ?? []) as CattleSale[], losses: (q.data?.losses ?? []) as CattleLoss[] },
    farmSel.selected?.id ?? null,
  );
  const today = todayIso();
  const farm = useMemo(() => summarizeFarm(lots, costs, sales, today, losses), [lots, costs, sales, today, losses]);
  const stock = useMemo(() => summarizeStock(lots, costs, sales, today, losses), [lots, costs, sales, today, losses]);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando painel...</p>;

  const cards = [
    { label: "Na fazenda agora", value: `${NUM.format(farm.activeHeads)} ${farm.activeHeads === 1 ? "cabeça" : "cabeças"}`, hint: `${BRL.format(farm.investedInActive)} investidos nelas` },
    { label: "Vendido", value: BRL.format(farm.soldAmount), hint: "" },
    { label: "Resultado dos lotes vendidos", value: BRL.format(farm.lotsResult), hint: "", tone: farm.lotsResult < 0 ? "neg" : "pos" },
    { label: "Custos gerais da fazenda", value: BRL.format(farm.generalCosts), hint: "Cerca, trator, roçada..." },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{farmSel.selected ? `Rebanho de ${farmSel.selected.name}.` : "Resumo do seu rebanho."}</p>
        </div>
        <Button asChild><Link to="/pecuaria"><Beef className="mr-2 h-4 w-4" />Abrir Pecuária</Link></Button>
      </div>

      {lots.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-muted-foreground">Nenhum lote ainda. Cadastre o primeiro para ver o resumo aqui.</p>
            <Button asChild size="lg" className="font-semibold"><Link to="/pecuaria" search={{ acao: "novo" }}>Cadastrar primeiro lote</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label} className="shadow-[var(--shadow-card)]">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle></CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${c.tone === "neg" ? "text-destructive" : c.tone === "pos" ? "text-primary" : ""}`}>{c.value}</p>
                {c.hint && <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {stock.detailed && (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-semibold">Estoque por idade e sexo</p>
            {stock.rows.filter((r) => r.total > 0).map((r) => (
              <p key={r.key}>{r.label}: {NUM.format(r.macho)} machos · {NUM.format(r.femea)} fêmeas{r.semSexo > 0 ? ` · ${r.semSexo} sem sexo` : ""}</p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
