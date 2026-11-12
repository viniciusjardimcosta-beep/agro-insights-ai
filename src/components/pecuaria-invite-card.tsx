import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Beef } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getActivities, setPecuariaEnabled } from "@/lib/cattle.functions";

const DISMISS_KEY = "agrointel:pecuaria-invite-dismissed";

function wasDismissed(): boolean {
  try { return window.localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

/** Convite para quem ainda não ligou a pecuária: um toque liga e já leva à tela. Some para quem já usa ou dispensou. */
export function PecuariaInviteCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["activities"], queryFn: () => getActivities(), staleTime: 300_000 });
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => (typeof window === "undefined" ? true : wasDismissed()));

  if (hidden || !q.data || q.data.pecuaria) return null;

  async function enable() {
    setBusy(true);
    try {
      await setPecuariaEnabled({ data: { enabled: true } });
      await qc.invalidateQueries({ queryKey: ["activities"] });
      navigate({ to: "/pecuaria" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* sem armazenamento: some só nesta visita */ }
    setHidden(true);
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Beef className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">Você também cria gado?</p>
            <p className="text-sm text-muted-foreground">Controle lotes, custos e vendas de recria e engorda, falando ou fotografando o caderno. Você pode desligar quando quiser em Configurações.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button className="font-semibold" disabled={busy} onClick={enable}>{busy ? "Ligando..." : "Ligar a Pecuária"}</Button>
          <Button variant="ghost" onClick={dismiss}>Agora não</Button>
        </div>
      </CardContent>
    </Card>
  );
}
