import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFarmSnapshot } from "@/lib/data.functions";
import { aggregateFarm, BRL, NUM } from "@/lib/calc";

const q = queryOptions({ queryKey: ["farm-snapshot"], queryFn: () => getFarmSnapshot() });

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — AgroIntel AI" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{error.message}</p>,
});

function Page() {
  const { data } = useSuspenseQuery(q);
  const farm = useMemo(
    () => aggregateFarm(data.fields as never, data.costs as never, data.prices as never),
    [data],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of data.costs) {
      const v = map.get(c.category) ?? 0;
      map.set(c.category, v + Number(c.amount));
    }
    return [...map.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [data.costs]);

  const fieldsRanked = useMemo(
    () => [...farm.perField].sort((a, b) => b.profitPerHa - a.profitPerHa),
    [farm.perField],
  );
  const best = fieldsRanked[0];
  const worst = fieldsRanked[fieldsRanked.length - 1];

  if (data.fields.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Relatórios</h1>
        <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Cadastre talhões e custos para ver os relatórios.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Análise comparativa dos seus talhões.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Custo / ha</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{BRL.format(farm.costPerHa)}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Receita estimada / ha</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{BRL.format(farm.totalArea > 0 ? farm.totalRevenue / farm.totalArea : 0)}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Lucro / ha</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${farm.profitPerHa < 0 ? "text-destructive" : "text-primary"}`}>{BRL.format(farm.profitPerHa)}</div></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Custo total por categoria</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.02 130)" />
                <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => BRL.format(v)} />
                <Bar dataKey="amount" fill="oklch(0.52 0.14 145)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Lucro / ha por talhão</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={farm.perField.map((f) => ({ name: f.field.name, lucro: Math.round(f.profitPerHa) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.02 130)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `R$ ${v}`} />
                <Tooltip formatter={(v: number) => BRL.format(v)} />
                <Bar dataKey="lucro" radius={[4, 4, 0, 0]}>
                  {farm.perField.map((f, i) => (
                    <Cell key={i} fill={f.profitPerHa < 0 ? "oklch(0.58 0.22 27)" : "oklch(0.52 0.14 145)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Talhão mais lucrativo</CardTitle></CardHeader>
          <CardContent>
            {best ? (
              <div>
                <div className="text-xl font-bold">{best.field.name}</div>
                <p className="text-sm text-muted-foreground capitalize">{best.field.crop} · {NUM.format(best.area)} ha</p>
                <p className="mt-2 text-sm">Lucro/ha: <span className="font-medium text-primary">{BRL.format(best.profitPerHa)}</span></p>
              </div>
            ) : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Talhão menos lucrativo</CardTitle></CardHeader>
          <CardContent>
            {worst ? (
              <div>
                <div className="text-xl font-bold">{worst.field.name}</div>
                <p className="text-sm text-muted-foreground capitalize">{worst.field.crop} · {NUM.format(worst.area)} ha</p>
                <p className={`mt-2 text-sm font-medium ${worst.profitPerHa < 0 ? "text-destructive" : ""}`}>Lucro/ha: {BRL.format(worst.profitPerHa)}</p>
              </div>
            ) : "—"}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}