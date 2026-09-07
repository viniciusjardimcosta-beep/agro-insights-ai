import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSubscription } from "@/hooks/use-subscription";
import { blockedMessage, type Feature } from "@/lib/entitlements";
import { canUse } from "@/lib/premium-guard";

/**
 * Guard central de rotas premium.
 *
 * - Enquanto valida: mostra carregamento (não renderiza os filhos, portanto
 *   nenhuma consulta específica da tela é disparada).
 * - Trial válido / assinatura ativa: libera.
 * - Trial vencido, cancelada, vencida ou pendente: paywall consistente.
 *
 * Isto é proteção de produto/UX. Operações que executam de fato (server
 * functions, rota de IA, geração do PDF) têm o seu próprio guard.
 */
export function PremiumRouteGuard({
  feature,
  children,
}: {
  feature: Feature;
  children: ReactNode;
}) {
  const { access, isLoading } = useSubscription();

  if (isLoading || !access) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Verificando sua assinatura...
      </div>
    );
  }

  if (canUse(access, feature)) return <>{children}</>;

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card className="border-amber-300/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-5 w-5 text-amber-600" />
            Recurso disponível no plano completo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>{blockedMessage(access)}</p>
          <p>
            Seus dados continuam salvos: propriedades, talhões, custos e preços
            seguem disponíveis, assim como exportar ou excluir sua conta.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/configuracoes/assinatura">Ver assinatura</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/dashboard">Voltar ao painel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
