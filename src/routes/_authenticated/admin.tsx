import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  amIAdmin,
  getAdminBilling,
  getAdminObservability,
  getAdminOverview,
  listAdminUsers,
  setFounderEligibility,
} from "@/lib/admin.functions";
import { toUserMessage } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administração — AgroIntel AI" },
      { name: "description", content: "Painel administrativo operacional do AgroIntel AI." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Administração — AgroIntel AI" },
      { property: "og:description", content: "Painel administrativo operacional do AgroIntel AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminGate,
});

/** Proteção de UI. A proteção real é o requireAdmin em cada função do servidor. */
function AdminGate() {
  const me = useServerFn(amIAdmin);
  const q = useQuery({ queryKey: ["admin", "me"], queryFn: () => me(), staleTime: 300_000 });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Verificando acesso…</p>;
  if (!q.data?.isAdmin) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Acesso negado
          </CardTitle>
          <CardDescription>Esta área é restrita à administração do AgroIntel.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/dashboard">Voltar ao painel</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <AdminPage />;
}

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const fmtDT = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");

const STATUS_LABEL: Record<string, string> = {
  trialing: "Teste",
  active: "Ativa",
  past_due: "Pendente",
  canceled: "Cancelada",
  expired: "Expirada",
  incomplete: "Incompleta",
};

function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ShieldCheck className="h-6 w-6 text-primary" /> Administração
        </h1>
        <p className="text-muted-foreground">Visão operacional. Somente leitura, exceto a elegibilidade ao Plano Fundador.</p>
      </div>
      <Overview />
      <Users />
      <div className="grid gap-6 lg:grid-cols-2">
        <Billing />
        <Observability />
      </div>
    </div>
  );
}

function Overview() {
  const fn = useServerFn(getAdminOverview);
  const { data } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => fn() });
  const cards = [
    ["Usuários", data?.users],
    ["Trials ativos", data?.trials],
    ["Assinaturas ativas", data?.active],
    ["Pagamento pendente", data?.pastDue],
    ["Canceladas/expiradas", data?.ended],
    ["Fundadores ativos", data?.founders],
    ["Elegíveis a Fundador", data?.founderEligible],
    ["Checkouts pendentes", data?.pending],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([label, v]) => (
        <Card key={label}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{v ?? "—"}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const list = useServerFn(listAdminUsers);
  const setFounder = useServerFn(setFounderEligibility);
  const [page, setPage] = useState(0);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin", "users", page, search],
    queryFn: () => list({ data: { page, search } }),
  });

  async function toggle(id: string, eligible: boolean) {
    setBusy(id);
    try {
      await setFounder({ data: { targetUserId: id, eligible } });
      toast.success(eligible ? "Elegibilidade ao Plano Fundador concedida." : "Elegibilidade revogada. Assinaturas ativas não mudam.");
      await qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      toast.error(toUserMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (q.data?.pageSize ?? 20)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Usuários</CardTitle>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setSearch(input);
          }}
        >
          <Input placeholder="Buscar por nome ou e-mail" value={input} onChange={(e) => setInput(e.target.value)} maxLength={80} />
          <Button type="submit" variant="outline">
            <Search className="h-4 w-4" />
          </Button>
        </form>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Usuário</th>
                <th className="pr-3">Cadastro</th>
                <th className="pr-3">Plano</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Teste até</th>
                <th className="pr-3">Período até</th>
                <th className="pr-3">Fundador</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.rows ?? []).map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2 pr-3">
                    <p className="font-medium">{u.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="pr-3">{fmt(u.createdAt)}</td>
                  <td className="pr-3">{u.subscription?.plan_code ?? "—"}</td>
                  <td className="pr-3">
                    {u.subscription ? (
                      <Badge variant="secondary">
                        {STATUS_LABEL[u.subscription.status] ?? u.subscription.status}
                        {u.subscription.cancel_at_period_end ? " · cancel. agendado" : ""}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="pr-3">{fmt(u.subscription?.trial_ends_at)}</td>
                  <td className="pr-3">{fmt(u.subscription?.current_period_ends_at)}</td>
                  <td className="pr-3">
                    <Button
                      size="sm"
                      variant={u.founderEligible ? "outline" : "default"}
                      disabled={busy === u.id}
                      onClick={() => toggle(u.id, !u.founderEligible)}
                    >
                      {busy === u.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {u.founderEligible ? "Revogar" : "Conceder"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {total} usuário(s) · página {page + 1} de {pages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Billing() {
  const fn = useServerFn(getAdminBilling);
  const { data } = useQuery({ queryKey: ["admin", "billing"], queryFn: () => fn() });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cobrança</CardTitle>
        <CardDescription>Checkouts e eventos recentes do gateway (sem dados sensíveis).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Checkouts</p>
          {(data?.checkouts ?? []).length === 0 && <p className="text-muted-foreground">Nenhum checkout.</p>}
          {(data?.checkouts ?? []).map((c) => (
            <div key={c.id} className="flex justify-between border-t py-1">
              <span>{c.plan_code}</span>
              <span>{c.status}</span>
              <span className="text-muted-foreground">{fmtDT(c.created_at)}</span>
            </div>
          ))}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Eventos do gateway</p>
          {(data?.events ?? []).length === 0 && <p className="text-muted-foreground">Nenhum evento.</p>}
          {(data?.events ?? []).map((e) => (
            <div key={e.id} className="flex justify-between gap-2 border-t py-1">
              <span>{e.event_type}</span>
              <span>
                {e.status}
                {e.error_code ? ` · ${e.error_code}` : ""}
              </span>
              <span className="text-muted-foreground">{fmtDT(e.processed_at ?? e.created_at)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Observability() {
  const fn = useServerFn(getAdminObservability);
  const { data } = useQuery({ queryKey: ["admin", "observability"], queryFn: () => fn() });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Falhas operacionais (7 dias)</CardTitle>
        <CardDescription>Apenas tipo, status e código de erro — nunca conteúdo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {(data?.counts ?? []).length === 0 && <p className="text-muted-foreground">Nenhuma falha registrada.</p>}
        {(data?.counts ?? []).map((c) => (
          <div key={c.eventType} className="flex justify-between border-t py-1">
            <span>{c.eventType}</span>
            <span className="font-semibold">{c.total}</span>
          </div>
        ))}
        {(data?.recent ?? []).length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Mais recentes</p>
            {data!.recent.map((r, i) => (
              <div key={i} className="flex justify-between gap-2 border-t py-1 text-xs">
                <span>{r.eventType}</span>
                <span>{r.errorCode ? String(r.errorCode) : r.status}</span>
                <span className="text-muted-foreground">{fmtDT(r.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
