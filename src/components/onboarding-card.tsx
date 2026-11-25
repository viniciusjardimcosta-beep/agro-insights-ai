import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Beef, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { quickStartFarm, quickStartRanch } from "@/lib/data.functions";
import { setActivities } from "@/lib/cattle.functions";
import { CROPS } from "@/lib/calc";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

const num = (s: string): number => Number(s.replace(/\./g, "").replace(",", "."));

type Kind = "plantio" | "pecuaria" | "ilp";

/** Primeiros passos: primeiro a pessoa diz o que faz (plantio, pecuária ou os dois) e o app pede só o que serve para isso. */
export function OnboardingCard() {
  const [kind, setKind] = useState<Kind | null>(null);
  if (kind === "pecuaria") return <RanchForm onBack={() => setKind(null)} />;
  if (kind) return <FarmForm withCattle={kind === "ilp"} onBack={() => setKind(null)} />;
  return (
    <Card className="border-primary/40 bg-primary/5 shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-xl">Qual é a sua atividade?</CardTitle>
        <CardDescription>Assim o app mostra só o que você usa. Dá para mudar depois em Configurações.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button type="button" variant="outline" size="lg" className="h-auto w-full justify-start gap-3 py-4 text-left" onClick={() => setKind("plantio")}>
          <Sprout className="h-6 w-6 shrink-0 text-primary" />
          <span><span className="block text-base font-semibold">Plantio</span><span className="block text-sm font-normal text-muted-foreground">Lavoura: soja, milho, trigo...</span></span>
        </Button>
        <Button type="button" variant="outline" size="lg" className="h-auto w-full justify-start gap-3 py-4 text-left" onClick={() => setKind("pecuaria")}>
          <Beef className="h-6 w-6 shrink-0 text-primary" />
          <span><span className="block text-base font-semibold">Pecuária</span><span className="block text-sm font-normal text-muted-foreground">Criação de gado: cria, recria e engorda.</span></span>
        </Button>
        <Button type="button" variant="outline" size="lg" className="h-auto w-full justify-start gap-3 py-4 text-left" onClick={() => setKind("ilp")}>
          <span className="flex shrink-0 gap-0.5"><Sprout className="h-6 w-6 text-primary" /><Beef className="h-6 w-6 text-primary" /></span>
          <span><span className="block text-base font-semibold">Plantio e pecuária (ILP)</span><span className="block text-sm font-normal text-muted-foreground">Lavoura e gado na mesma propriedade, como na entressafra.</span></span>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Quem cria gado: só nome, estado e área de pasto. Sem cultura nem área plantada. */
function RanchForm({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useServerFn(quickStartRanch);
  const [name, setName] = useState("");
  const [uf, setUf] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const areaN = area.trim() === "" ? 0 : num(area);
  const valid = name.trim() !== "" && uf !== "" && areaN >= 0 && !Number.isNaN(areaN);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await create({ data: { name: name.trim(), state: uf, area: areaN > 0 ? areaN : null } });
      await setActivities({ data: { lavoura: false, pecuaria: true } });
      await qc.invalidateQueries();
      toast.success("Tudo pronto! Agora cadastre o primeiro lote.");
      navigate({ to: "/pecuaria", search: { acao: "novo" } });
    } catch (err) {
      toast.error("Não foi possível salvar", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/40 bg-primary/5 shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl"><Beef className="h-5 w-5 text-primary" />Comece em 1 minuto</CardTitle>
        <CardDescription>Só 2 informações. Depois você cadastra o primeiro lote.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rn-name">Nome da fazenda</Label>
            <Input id="rn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Fazenda Boa Vista" autoComplete="off" />
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
              <Label htmlFor="rn-area">Área de pasto (ha), se souber</Label>
              <Input id="rn-area" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ex.: 80" />
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full text-base font-semibold" disabled={!valid || busy}>
            {busy ? "Salvando..." : "Começar"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>Trocar atividade</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Primeiros passos do plantio: fazenda, estado, cultura e área. Cria a fazenda e o primeiro talhão. */
function FarmForm({ withCattle, onBack }: { withCattle: boolean; onBack: () => void }) {
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
          withCattle,
        },
      });
      if (withCattle) await setActivities({ data: { lavoura: true, pecuaria: true } });
      await qc.invalidateQueries();
      toast.success(withCattle ? "Tudo pronto! A Pecuária já está no menu." : "Tudo pronto! Agora lance o primeiro custo.");
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
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>Trocar atividade</Button>
        </form>
      </CardContent>
    </Card>
  );
}
