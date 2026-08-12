import { useMemo } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellRing, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { acknowledgeAlert, listAlerts, syncAlerts } from "@/lib/alerts.functions";
import { durationLabel, type AlertStatus } from "@/lib/alerts-rules";

export const Route = createFileRoute("/_authenticated/alertas")({
  head: () => ({
    meta: [
      { title: "Alertas Inteligentes — AgroIntel AI" },
      {
        name: "description",
        content:
          "Alertas persistentes e rastreáveis da sua propriedade: problemas ativos, reconhecidos e resolvidos.",
      },
      { property: "og:title", content: "Alertas Inteligentes — AgroIntel AI" },
      {
        property: "og:description",
        content: "Acompanhe os problemas financeiros da fazenda do início até a resolução.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlertasPage,
  errorComponent: ({ error }) => (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Erro: {error.message}
    </div>
  ),
});

export const alertsQuery = queryOptions({
  queryKey: ["alerts"],
  queryFn: () => listAlerts(),
});

type AlertRow = Awaited<ReturnType<typeof listAlerts>>[number];

const SEV = {
  critical: { label: "Crítico", cls: "bg-destructive text-destructive-foreground" },
  high: { label: "Alto", cls: "bg-warning text-warning-foreground" },
  medium: { label: "Médio", cls: "bg-muted text-muted-foreground" },
} as const;

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleDateString("pt-BR") : "—";
}

function AlertCard({
  alert,
  onAck,
  acking,
}: {
  alert: AlertRow;
  onAck: (id: string) => void;
  acking: boolean;
}) {
  const sev = SEV[(alert.severity as keyof typeof SEV) ?? "medium"] ?? SEV.medium;
  const resolved = alert.status === "resolved";
  return (
    <div className="space-y-2 rounded-lg border p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">{alert.title}</span>
        <div className="flex items-center gap-2">
          {alert.status === "acknowledged" && <Badge variant="outline">Reconhecido</Badge>}
          {resolved && <Badge variant="outline">Resolvido</Badge>}
          <Badge className={sev.cls}>{sev.label}</Badge>
        </div>
      </div>
      <p className="text-muted-foreground">{alert.message}</p>
      <div>
        <span className="text-muted-foreground">
          {resolved ? "Último valor observado: " : "Métrica atual: "}
        </span>
        {alert.metric_value ?? "—"}
      </div>
      {alert.previous_value && (
        <div>
          <span className="text-muted-foreground">Valor anterior: </span>
          {alert.previous_value}
        </div>
      )}
      {alert.impact && (
        <div>
          <span className="text-muted-foreground">Impacto: </span>
          {alert.impact}
        </div>
      )}
      <div className="text-muted-foreground">
        Primeira ocorrência: {fmt(alert.first_seen_at)} · Última: {fmt(alert.last_seen_at)}
        {resolved && alert.resolved_at && (
          <>
            {" "}
            · Resolvido em {fmt(alert.resolved_at)} (durou{" "}
            {durationLabel(alert.first_seen_at, alert.resolved_at)})
          </>
        )}
      </div>
      {!resolved && alert.action_label && (
        <div>
          <span className="text-muted-foreground">Ação sugerida: </span>
          {alert.action_label}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {!resolved && alert.action_route && (
          <Button asChild size="sm" variant="outline">
            <Link to={alert.action_route}>Ver</Link>
          </Button>
        )}
        {alert.status === "active" && (
          <Button size="sm" disabled={acking} onClick={() => onAck(alert.id)}>
            Reconhecer
          </Button>
        )}
      </div>
    </div>
  );
}

function List({
  alerts,
  empty,
  emptySub,
  onAck,
  acking,
}: {
  alerts: AlertRow[];
  empty: string;
  emptySub?: string;
  onAck: (id: string) => void;
  acking: boolean;
}) {
  if (alerts.length === 0) {
    return (
      <div className="space-y-1 rounded-lg border border-primary/30 bg-primary/5 p-6 text-center">
        <div className="flex items-center justify-center gap-2 font-medium text-primary">
          <CheckCircle2 className="h-5 w-5" /> {empty}
        </div>
        {emptySub && <p className="text-sm text-muted-foreground">{emptySub}</p>}
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {alerts.map((a) => (
        <AlertCard key={a.id} alert={a} onAck={onAck} acking={acking} />
      ))}
    </div>
  );
}

function AlertasPage() {
  const qc = useQueryClient();
  const q = useQuery(alertsQuery);

  const sync = useMutation({
    mutationFn: () => syncAlerts(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Alertas reavaliados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ack = useMutation({
    mutationFn: (id: string) => acknowledgeAlert({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Alerta reconhecido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const groups = useMemo(() => {
    const all = (q.data ?? []) as AlertRow[];
    const by = (s: AlertStatus) => all.filter((a) => a.status === s);
    return { active: by("active"), acknowledged: by("acknowledged"), resolved: by("resolved") };
  }, [q.data]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BellRing className="h-6 w-6 text-primary" /> Alertas Inteligentes
          </h1>
          <p className="text-muted-foreground">
            Problemas detectados pelas regras da Central de Inteligência, acompanhados ao longo do
            tempo.
          </p>
        </div>
        <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Reavaliar agora
        </Button>
      </header>

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando alertas...
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Acompanhamento</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="active">
              <TabsList>
                <TabsTrigger value="active">Ativos ({groups.active.length})</TabsTrigger>
                <TabsTrigger value="acknowledged">
                  Reconhecidos ({groups.acknowledged.length})
                </TabsTrigger>
                <TabsTrigger value="resolved">Resolvidos ({groups.resolved.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="active" className="mt-4">
                <List
                  alerts={groups.active}
                  empty="Sem alertas prioritários no momento."
                  emptySub="Continuaremos acompanhando os indicadores da propriedade."
                  onAck={(id) => ack.mutate(id)}
                  acking={ack.isPending}
                />
              </TabsContent>
              <TabsContent value="acknowledged" className="mt-4">
                <List
                  alerts={groups.acknowledged}
                  empty="Nenhum alerta reconhecido."
                  emptySub="Alertas reconhecidos continuam sendo monitorados até serem resolvidos."
                  onAck={(id) => ack.mutate(id)}
                  acking={ack.isPending}
                />
              </TabsContent>
              <TabsContent value="resolved" className="mt-4">
                <List
                  alerts={groups.resolved}
                  empty="Nenhum alerta registrado ainda."
                  onAck={(id) => ack.mutate(id)}
                  acking={ack.isPending}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
