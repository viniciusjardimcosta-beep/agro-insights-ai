import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cancelMySubscription, createCheckout, getBillingStatus } from "@/lib/billing/billing.functions";
import { annualSavingsCents, formatBRL } from "@/lib/billing/plans";
import { toUserMessage } from "@/lib/errors";
import { useSubscription } from "@/hooks/use-subscription";

const PRICE_SUFFIX = { month: "/mês", year: "/ano" } as const;

/** Planos e ações de cobrança. Nenhum valor monetário sai do navegador: só o plan_code. */
export function BillingActions() {
  const qc = useQueryClient();
  const { access } = useSubscription();
  const fetchStatus = useServerFn(getBillingStatus);
  const checkout = useServerFn(createCheckout);
  const cancel = useServerFn(cancelMySubscription);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: billing, isLoading } = useQuery({ queryKey: ["billing-status"], queryFn: () => fetchStatus() });

  const subscribed =
    !!access &&
    !access.cancelAtPeriodEnd &&
    (access.status === "active" || access.status === "past_due" || billing?.recurrenceScheduled);

  async function startCheckout(planCode: string) {
    setBusy(planCode);
    try {
      const { url } = await checkout({ data: { planCode } });
      window.location.assign(url);
    } catch (err) {
      toast.error(toUserMessage(err));
      setBusy(null);
    }
  }

  async function doCancel() {
    setBusy("cancel");
    try {
      await cancel();
      toast.success("Cancelamento registrado. Nenhuma nova cobrança será feita.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["subscription"] }),
        qc.invalidateQueries({ queryKey: ["billing-status"] }),
      ]);
    } catch (err) {
      toast.error(toUserMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando planos…</p>;

  if (!billing?.configured) {
    return (
      <p className="text-sm text-muted-foreground">
        A contratação de planos ainda não está disponível. Você continua com acesso normal enquanto isso.
      </p>
    );
  }

  if (subscribed) {
    return (
      <div className="space-y-3">
        {billing.recurrenceScheduled && (
          <p className="text-sm text-muted-foreground">
            Assinatura contratada. A primeira cobrança acontece ao fim do teste gratuito.
          </p>
        )}
        {access?.status === "past_due" && (
          <p className="text-sm text-destructive">
            Não conseguimos processar o último pagamento. Seus dados estão preservados.
          </p>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={busy === "cancel"}>
              {busy === "cancel" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancelar assinatura
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar assinatura?</AlertDialogTitle>
              <AlertDialogDescription>
                Nenhuma nova cobrança será feita. Você mantém o acesso até o fim do período já pago
                {billing.planCode === "pro_founder_monthly"
                  ? ". O preço de fundador não poderá ser recuperado em uma nova assinatura."
                  : "."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Manter assinatura</AlertDialogCancel>
              <AlertDialogAction onClick={doCancel}>Confirmar cancelamento</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="text-xs text-muted-foreground">
          Para trocar o cartão, cancele e assine novamente. Nenhum dado de cartão é armazenado pelo AgroIntel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">AgroIntel Pro</p>
        <p className="text-sm text-muted-foreground">Pagamento por cartão de crédito em ambiente seguro.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {billing.plans.map((p) => (
          <div key={p.planCode} className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">
                {p.founder ? "Plano Fundador" : p.interval === "year" ? "Anual" : "Mensal"}
              </p>
              {p.founder && (
                <Badge>
                  <Star className="mr-1 h-3 w-3" /> Fundador
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold">
              {formatBRL(p.amountCents)}
              <span className="text-sm font-normal text-muted-foreground">{PRICE_SUFFIX[p.interval]}</span>
            </p>
            {p.interval === "year" && (
              <p className="text-sm text-primary">Economize {formatBRL(annualSavingsCents())} por ano</p>
            )}
            {p.founder && (
              <p className="text-sm text-muted-foreground">
                Preço especial mantido enquanto sua assinatura permanecer ativa.
              </p>
            )}
            <Button className="mt-auto" disabled={!!busy} onClick={() => startCheckout(p.planCode)}>
              {busy === p.planCode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {p.founder ? "Assinar como fundador" : p.interval === "year" ? "Assinar anual" : "Assinar mensal"}
            </Button>
          </div>
        ))}
      </div>
      {access?.isTrial && (
        <p className="text-xs text-muted-foreground">
          Assinando agora, a primeira cobrança só acontece quando o teste gratuito terminar.
        </p>
      )}
      <Button variant="ghost" asChild>
        <Link to="/configuracoes">Voltar às configurações</Link>
      </Button>
    </div>
  );
}
