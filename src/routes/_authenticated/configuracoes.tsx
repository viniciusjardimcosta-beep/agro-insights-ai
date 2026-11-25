import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { exportMyData, deleteMyAccount } from "@/lib/account.functions";
import { exportFileName } from "@/lib/account-export";
import { clearMonitoringUser } from "@/lib/monitoring";
import { toUserMessage } from "@/lib/errors";
import { LEGAL_DISCLAIMER, PRIVACY_CONTACT } from "@/lib/privacy";
import { useSubscription } from "@/hooks/use-subscription";
import { CreditCard } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { getActivities, setActivities } from "@/lib/cattle.functions";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações e privacidade — AgroIntel AI" },
      {
        name: "description",
        content: "Exporte seus dados da fazenda, consulte a política de privacidade e exclua sua conta do AgroIntel AI.",
      },
      { property: "og:title", content: "Configurações e privacidade — AgroIntel AI" },
      { property: "og:description", content: "Portabilidade, privacidade e exclusão de conta no AgroIntel AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const payload = await exportMyData();
      // Download direto via Blob — sem persistência, sem URL pública.
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success("Exportação concluída", { description: "O arquivo JSON foi baixado no seu dispositivo." });
    } catch (err) {
      toast.error("Falha na exportação", { description: toUserMessage(err) });
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    if (confirmation.trim().toUpperCase() !== "EXCLUIR") return;
    setDeleting(true);
    try {
      await deleteMyAccount({ data: { confirmation } });
      clearMonitoringUser();
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      toast.success("Conta excluída", { description: "Seus dados foram removidos do AgroIntel." });
      navigate({ to: "/", replace: true });
    } catch (err) {
      // Falha parcial não pode deixar a interface em estado inconsistente:
      // a sessão permanece válida e nada é limpo localmente.
      toast.error("Não foi possível excluir a conta", { description: toUserMessage(err) });
      setDeleting(false);
    }
  }

  const canDelete = confirmation.trim().toUpperCase() === "EXCLUIR";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações e privacidade</h1>
        <p className="text-muted-foreground">Portabilidade, privacidade e encerramento da conta.</p>
      </div>

      <AccountCard />

      <SubscriptionSummaryCard />

      <ActivitiesCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" /> Exportar meus dados
          </CardTitle>
          <CardDescription>
            Baixe um arquivo JSON estruturado com perfil, propriedades, talhões, custos, preços, diagnósticos,
            cenários, alertas e conversas com o Consultor IA. O arquivo é gerado sob demanda e entregue apenas a você —
            não fica armazenado em nenhum servidor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? "Gerando arquivo..." : "Exportar meus dados"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentos e contato</CardTitle>
          <CardDescription>{LEGAL_DISCLAIMER}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <Link to="/privacidade" className="text-primary underline">
              Política de Privacidade
            </Link>{" "}
            ·{" "}
            <Link to="/termos" className="text-primary underline">
              Termos de Uso
            </Link>
          </p>
          <p className="text-muted-foreground">Contato para privacidade: {PRIVACY_CONTACT}</p>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" /> Excluir minha conta
          </CardTitle>
          <CardDescription>
            A exclusão da conta removerá permanentemente seus dados do AgroIntel: propriedades, talhões, custos,
            preços, diagnósticos, cenários, alertas e conversas com o Consultor IA. Esta ação não pode ser desfeita.
            Registros técnicos de auditoria são mantidos de forma anonimizada, sem vínculo com você.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="confirm-delete">
            Para confirmar, digite <strong>EXCLUIR</strong>
          </Label>
          <Input
            id="confirm-delete"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="EXCLUIR"
            autoComplete="off"
          />
          <Button variant="destructive" onClick={handleDelete} disabled={!canDelete || deleting}>
            <Trash2 className="mr-2 h-4 w-4" />
            {deleting ? "Excluindo..." : "Excluir minha conta permanentemente"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Resumo do acesso; o detalhe fica em /configuracoes/assinatura. */
function SubscriptionSummaryCard() {
  const { access, isLoading } = useSubscription();
  const label = !access
    ? "Carregando…"
    : access.isTrial
      ? `Teste gratuito — ${access.trialDaysRemaining === 1 ? "1 dia restante" : `${access.trialDaysRemaining} dias restantes`}`
      : access.accessLevel === "full"
        ? "Plano Pro — ativo"
        : "Sem acesso premium";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> Assinatura
        </CardTitle>
        <CardDescription>{isLoading ? "Carregando seu status…" : label}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" asChild>
          <Link to="/configuracoes/assinatura">Ver assinatura</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ActivitiesCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["activities"], queryFn: () => getActivities() });
  const [busy, setBusy] = useState(false);
  const lavoura = q.data?.lavoura !== false;
  const pecuaria = q.data?.pecuaria === true;

  async function change(next: { lavoura: boolean; pecuaria: boolean }) {
    setBusy(true);
    try {
      await setActivities({ data: next });
      await qc.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Atividades atualizadas. O menu já mudou.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Atividades da fazenda</CardTitle>
        <CardDescription>Mostre no menu só o que você usa. Os seus dados não são apagados ao desligar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Plantio (lavoura)</p>
            <p className="text-sm text-muted-foreground">Talhões, custos por área, preços das culturas e simulador.</p>
          </div>
          <Switch checked={lavoura} disabled={busy || q.isLoading || (lavoura && !pecuaria)} onCheckedChange={(v) => change({ lavoura: v, pecuaria })} aria-label="Ligar o plantio" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Pecuária (cria, recria e engorda)</p>
            <p className="text-sm text-muted-foreground">Lotes, custos, vendas, baixas, nascimentos e estoque por idade.</p>
          </div>
          <Switch checked={pecuaria} disabled={busy || q.isLoading || (pecuaria && !lavoura)} onCheckedChange={(v) => change({ lavoura, pecuaria: v })} aria-label="Ligar a pecuária" />
        </div>
        <p className="text-xs text-muted-foreground">Pelo menos uma atividade fica ligada.</p>
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const q = useQuery({
    queryKey: ["account-info"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: 60_000,
  });
  const u = q.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Minha conta</CardTitle>
        <CardDescription>Os dados com que você entrou no app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p><span className="text-muted-foreground">E-mail: </span><span className="font-medium">{u?.email ?? (q.isLoading ? "Carregando..." : "—")}</span></p>
        {u?.created_at && <p><span className="text-muted-foreground">Conta criada em: </span>{new Date(u.created_at).toLocaleDateString("pt-BR")}</p>}
      </CardContent>
    </Card>
  );
}
