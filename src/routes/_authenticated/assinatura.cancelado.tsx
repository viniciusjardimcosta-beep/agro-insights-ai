import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/assinatura/cancelado")({
  head: () => ({
    meta: [
      { title: "Contratação não concluída — AgroIntel AI" },
      { name: "description", content: "A contratação do plano AgroIntel AI não foi concluída. Nenhuma cobrança foi feita." },
      { property: "og:title", content: "Contratação não concluída — AgroIntel AI" },
      { property: "og:description", content: "Nenhuma cobrança foi feita." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardHeader>
          <CardTitle>Contratação não concluída</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>Você saiu da página de pagamento ou ela expirou. Nenhuma assinatura foi criada.</p>
          <Button asChild>
            <Link to="/configuracoes/assinatura">Voltar aos planos</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  ),
});
