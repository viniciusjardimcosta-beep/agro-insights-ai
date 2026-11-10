import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { quickStartFarm } from "@/lib/data.functions";
import { CROPS } from "@/lib/calc";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

const num = (s: string): number => Number(s.replace(/\./g, "").replace(",", "."));

/** Primeiros passos em uma tela só: fazenda, estado, cultura e área. Cria a propriedade e o primeiro talhão. */
export function OnboardingCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useServerFn(quickStartFarm);
  const [name, setName] = useState("");
  const [uf, setUf] = useState("");
  const [crop, setCrop] = useState<string>("soja");
  const [area, setArea] = useState("");
  const [yieldStr, setYieldStr] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [busy, setBusy] = useState(false);

  const areaN = num(area);
  const valid = name.trim() !== "" && uf !== "" && areaN > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await create({
        data: {
          name: name.trim(),
          state: uf,
          crop,
          area: areaN,
          estimated_yield: yieldStr.trim() !== "" && num(yieldStr) >= 0 ? num(yieldStr) : null,
          price_per_bag: priceStr.trim() !== "" && num(priceStr) > 0 ? num(priceStr) : null,
        },
      });
      await qc.invalidateQueries();
      toast.success("Tudo pronto! Agora lance o primeiro custo.");
      navigate({ to: "/custos" });
    } catch (err) {
      toast.error("Não foi possível salvar", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/40 bg-primary/5 shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl"><Sprout className="h-5 w-5 text-primary" />Comece em 1 minuto</CardTitle>
        <CardDescription>Só 4 informações. Depois você já pode lançar custos, até falando.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ob-name">Nome da fazenda</Label>
            <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Fazenda Boa Vista" autoComplete="off" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select value={uf} onValueChange={setUf}>
                <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>{UFS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cultura principal</Label>
              <Select value={crop} onValueChange={setCrop}>
                <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>{CROPS.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ob-area">Área plantada (hectares)</Label>
            <Input id="ob-area" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ex.: 120" />
          </div>

          <details className="rounded-md border bg-background p-3 text-sm">
            <summary className="cursor-pointer font-medium">Quer ver o lucro estimado já? (opcional)</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ob-yield">Produtividade (sacas/ha)</Label>
                <Input id="ob-yield" inputMode="decimal" value={yieldStr} onChange={(e) => setYieldStr(e.target.value)} placeholder="Ex.: 60" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-price">Preço da saca (R$)</Label>
                <Input id="ob-price" inputMode="decimal" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} placeholder="Ex.: 130" />
              </div>
            </div>
          </details>

          <Button type="submit" size="lg" className="w-full text-base font-semibold" disabled={!valid || busy}>
            {busy ? "Salvando..." : "Começar"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Você pode dividir a área em mais talhões depois, em Talhões. O nome, o estado e os outros dados podem ser mudados quando quiser.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
