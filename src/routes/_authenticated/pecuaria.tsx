import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Banknote, Beef, Pencil, Plus, Trash2, HandCoins } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addCattleCost, addCattleSale, deleteCattleCost, deleteCattleSale, deleteLot, listCattle, saveLot,
} from "@/lib/cattle.functions";
import {
  CATTLE_COST_CATEGORIES, CATTLE_PHASES, pricePerArroba, summarizeFarm, summarizeLot,
  type CattleCost, type CattleSale, type Lot,
} from "@/lib/cattle";
import { parseMoney } from "@/lib/cost-import";
import { BRL, NUM } from "@/lib/calc";

const qCattle = queryOptions({ queryKey: ["cattle"], queryFn: () => listCattle() });

export const Route = createFileRoute("/_authenticated/pecuaria")({
  head: () => ({ meta: [{ title: "Pecuária — AgroIntel AI" }] }),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{(error as Error).message}</p>,
});

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");
const PHASE_LABEL: Record<string, string> = { recria: "Recria", engorda: "Engorda" };

function Page() {
  const q = useQuery(qCattle);
  const qc = useQueryClient();
  const delLot = useServerFn(deleteLot);
  const delCost = useServerFn(deleteCattleCost);
  const delSale = useServerFn(deleteCattleSale);

  const [lotOpen, setLotOpen] = useState(false);
  const [editing, setEditing] = useState<Lot | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [costLot, setCostLot] = useState<string>("geral");
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleLot, setSaleLot] = useState<string>("");

  const data = q.data;
  const lots = (data?.lots ?? []) as Lot[];
  const costs = (data?.costs ?? []) as CattleCost[];
  const sales = (data?.sales ?? []) as CattleSale[];
  const today = todayIso();
  const farm = useMemo(() => summarizeFarm(lots, costs, sales, today), [lots, costs, sales, today]);
  const activeLots = lots.filter((l) => summarizeLot(l, costs, sales, today).headsLeft > 0);

  async function refresh() { await qc.invalidateQueries({ queryKey: ["cattle"] }); }
  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); await refresh(); toast.success(ok); } catch (e) { toast.error((e as Error).message); }
  }

  if (q.isLoading) return <p className="text-muted-foreground">Carregando...</p>;
  if (q.error) return <p className="text-destructive">{(q.error as Error).message}</p>;
  if (data && !data.ready) {
    return (
      <Card className="border-dashed">
        <CardContent className="space-y-2 py-10 text-center">
          <p className="text-lg font-semibold">A pecuária está sendo preparada</p>
          <p className="text-sm text-muted-foreground">Esta parte ainda não está liberada para a sua conta. Assim que estiver, ela aparece aqui.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pecuária</h1>
          <p className="text-sm text-muted-foreground">Recria e engorda: cadastre o lote, lance os custos e registre a venda. O app mostra o resultado e o custo por arroba.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex">
          <Button className="col-span-2 font-semibold md:col-span-1" onClick={() => { setEditing(null); setLotOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />Novo lote
          </Button>
          <Button variant="outline" onClick={() => { setCostLot(activeLots[0]?.id ?? "geral"); setCostOpen(true); }}>
            <Banknote className="mr-2 h-4 w-4" />Lançar custo
          </Button>
          <Button variant="outline" disabled={activeLots.length === 0} onClick={() => { setSaleLot(activeLots[0]?.id ?? ""); setSaleOpen(true); }}>
            <HandCoins className="mr-2 h-4 w-4" />Registrar venda
          </Button>
        </div>
      </div>

      {lots.length === 0 ? (
        <Card className="border-dashed border-primary/40 bg-primary/5">
          <CardContent className="space-y-4 py-10 text-center">
            <Beef className="mx-auto h-8 w-8 text-primary" />
            <p className="text-lg font-semibold">Cadastre o seu primeiro lote</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Um lote é o grupo de animais que você comprou junto. Informe quantas cabeças, a data e o valor pago. Depois é só lançar os custos e, na hora da venda, o valor.
            </p>
            <Button size="lg" className="font-semibold" onClick={() => { setEditing(null); setLotOpen(true); }}>
              <Plus className="mr-2 h-5 w-5" />Novo lote
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Na fazenda agora" value={`${NUM.format(farm.activeHeads)} cabeças`} hint={`${BRL.format(farm.investedInActive)} investidos nelas`} />
            <Stat label="Vendido" value={BRL.format(farm.soldAmount)} />
            <Stat label="Resultado dos lotes vendidos" value={BRL.format(farm.lotsResult)} tone={farm.lotsResult} />
            <Stat label="Custos gerais da fazenda" value={BRL.format(farm.generalCosts)} hint={farm.generalCosts > 0 ? `Resultado depois deles: ${BRL.format(farm.resultAfterGeneral)}` : "Cerca, trator, roçada..."} />
          </div>

          <div className="space-y-4">
            {lots.map((lot) => {
              const s = summarizeLot(lot, costs, sales, today);
              const lotCosts = costs.filter((c) => c.lot_id === lot.id);
              const lotSales = sales.filter((x) => x.lot_id === lot.id);
              return (
                <Card key={lot.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold">{lot.name}</h2>
                          <Badge variant="outline">{PHASE_LABEL[lot.phase] ?? lot.phase}</Badge>
                          <Badge variant={s.fullySold ? "secondary" : "default"}>{s.fullySold ? "Vendido" : "Na fazenda"}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {lot.head_count} cabeças · entrada {fmtDate(lot.entry_date)}
                          {lot.entry_avg_weight_kg ? ` · ${NUM.format(Number(lot.entry_avg_weight_kg))} kg em média` : ""} · {s.days} dias
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" aria-label="Editar lote" onClick={() => { setEditing(lot); setLotOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Excluir lote" onClick={() => {
                          if (confirm(`Excluir o lote "${lot.name}" com todos os custos e vendas dele? Isso não pode ser desfeito.`)) run(() => delLot({ data: { id: lot.id } }), "Lote excluído");
                        }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>

                    <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <Line label="Investido (compra + custos)" value={BRL.format(s.invested)} />
                      <Line label="Custo por cabeça" value={BRL.format(s.costPerHead)} />
                      {s.headsSold > 0 && <Line label={`Vendido (${s.headsSold} cab.)`} value={BRL.format(s.soldAmount)} />}
                      {s.pricePerArroba !== null && <Line label="Preço médio da arroba" value={BRL.format(s.pricePerArroba)} />}
                      {s.costPerArroba !== null && <Line label="Custo por arroba vendida" value={BRL.format(s.costPerArroba)} />}
                      {s.result !== null && (
                        <Line
                          label={s.fullySold ? "Resultado do lote" : "Resultado das cabeças vendidas"}
                          value={`${BRL.format(s.result)}${s.marginPct !== null ? ` (${NUM.format(s.marginPct)}%)` : ""}`}
                          tone={s.result}
                        />
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setCostLot(lot.id); setCostOpen(true); }}><Banknote className="mr-1.5 h-4 w-4" />Custo</Button>
                      {s.headsLeft > 0 && (
                        <Button size="sm" variant="outline" onClick={() => { setSaleLot(lot.id); setSaleOpen(true); }}><HandCoins className="mr-1.5 h-4 w-4" />Venda</Button>
                      )}
                    </div>

                    {(lotCosts.length > 0 || lotSales.length > 0) && (
                      <details className="rounded-md border bg-muted/30 p-3 text-sm">
                        <summary className="cursor-pointer font-medium">Lançamentos ({lotCosts.length} custos, {lotSales.length} vendas)</summary>
                        <ul className="mt-2 space-y-1.5">
                          {lotSales.map((x) => (
                            <li key={x.id} className="flex items-center justify-between gap-2">
                              <span>{fmtDate(x.date)} · Venda de {x.head_count} cab.{x.arrobas ? ` · ${NUM.format(Number(x.arrobas))} @` : ""}</span>
                              <span className="flex items-center gap-1 font-medium">{BRL.format(Number(x.amount))}
                                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Excluir venda" onClick={() => { if (confirm("Excluir esta venda?")) run(() => delSale({ data: { id: x.id } }), "Venda excluída"); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </span>
                            </li>
                          ))}
                          {lotCosts.map((c) => (
                            <li key={c.id} className="flex items-center justify-between gap-2">
                              <span>{fmtDate(c.date)} · {c.category}{c.description ? ` · ${c.description}` : ""}</span>
                              <span className="flex items-center gap-1">{BRL.format(Number(c.amount))}
                                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Excluir custo" onClick={() => { if (confirm("Excluir este custo?")) run(() => delCost({ data: { id: c.id } }), "Custo excluído"); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {costs.some((c) => c.lot_id === null) && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <h2 className="font-semibold">Custos gerais da fazenda</h2>
                <ul className="space-y-1.5 text-sm">
                  {costs.filter((c) => c.lot_id === null).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span>{fmtDate(c.date)} · {c.category}{c.description ? ` · ${c.description}` : ""}</span>
                      <span className="flex items-center gap-1">{BRL.format(Number(c.amount))}
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Excluir custo" onClick={() => { if (confirm("Excluir este custo?")) run(() => delCost({ data: { id: c.id } }), "Custo excluído"); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <LotDialog open={lotOpen} onOpenChange={setLotOpen} lot={editing} onSaved={refresh} />
      <CostDialog open={costOpen} onOpenChange={setCostOpen} lots={lots} initialLot={costLot} onSaved={refresh} />
      <SaleDialog open={saleOpen} onOpenChange={setSaleOpen} lots={activeLots} costs={costs} sales={sales} initialLot={saleLot} onSaved={refresh} />
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold ${tone === undefined ? "" : tone >= 0 ? "text-primary" : "text-destructive"}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-medium ${tone === undefined ? "" : tone >= 0 ? "text-primary" : "text-destructive"}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------- lote
function LotDialog({ open, onOpenChange, lot, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; lot: Lot | null; onSaved: () => Promise<void> }) {
  const save = useServerFn(saveLot);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<string>("engorda");
  const [heads, setHeads] = useState("");
  const [entry, setEntry] = useState(todayIso());
  const [weight, setWeight] = useState("");
  const [paid, setPaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);

  // Preenche o formulário ao abrir (novo ou edição).
  const key = open ? (lot?.id ?? "novo") : null;
  if (key !== seed) {
    setSeed(key);
    if (open) {
      setName(lot?.name ?? "");
      setPhase(lot?.phase ?? "engorda");
      setHeads(lot ? String(lot.head_count) : "");
      setEntry(lot?.entry_date ?? todayIso());
      setWeight(lot?.entry_avg_weight_kg ? String(lot.entry_avg_weight_kg).replace(".", ",") : "");
      setPaid(lot ? String(lot.purchase_amount).replace(".", ",") : "");
    }
  }

  const headsN = Number.parseInt(heads, 10);
  const paidN = parseMoney(paid);
  const weightN = weight.trim() === "" ? null : parseMoney(weight);
  const valid = name.trim() !== "" && headsN > 0 && paidN !== null && /^\d{4}-\d{2}-\d{2}$/.test(entry) && (weight.trim() === "" || (weightN !== null && weightN > 0));

  async function submit() {
    if (!valid || paidN === null) return;
    setBusy(true);
    try {
      await save({ data: { id: lot?.id, name: name.trim(), phase: phase as "recria" | "engorda", head_count: headsN, entry_date: entry, entry_avg_weight_kg: weightN, purchase_amount: paidN } });
      await onSaved();
      toast.success(lot ? "Lote atualizado" : "Lote cadastrado");
      onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lot ? "Editar lote" : "Novo lote"}</DialogTitle>
          <DialogDescription>O grupo de animais que você comprou junto.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="lot-name">Nome do lote</Label><Input id="lot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Garrotes de março" autoComplete="off" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fase</Label>
              <Select value={phase} onValueChange={setPhase}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATTLE_PHASES.map((p) => <SelectItem key={p} value={p}>{PHASE_LABEL[p]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="lot-heads">Cabeças</Label><Input id="lot-heads" inputMode="numeric" value={heads} onChange={(e) => setHeads(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 50" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="lot-date">Data de entrada</Label><Input id="lot-date" type="date" value={entry} max={todayIso()} onChange={(e) => setEntry(e.target.value)} /></div>
            <div><Label htmlFor="lot-weight">Peso médio (kg), se souber</Label><Input id="lot-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Ex.: 300" /></div>
          </div>
          <div><Label htmlFor="lot-paid">Valor total pago no lote (R$)</Label><Input id="lot-paid" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="Ex.: 150.000" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="font-semibold" disabled={!valid || busy} onClick={submit}>{busy ? "Salvando..." : "Salvar lote"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- custo
function CostDialog({ open, onOpenChange, lots, initialLot, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; lots: Lot[]; initialLot: string; onSaved: () => Promise<void> }) {
  const add = useServerFn(addCattleCost);
  const [target, setTarget] = useState("geral");
  const [category, setCategory] = useState<string>(CATTLE_COST_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(false);

  if (open !== seed) {
    setSeed(open);
    if (open) { setTarget(initialLot); setAmount(""); setDate(todayIso()); setDesc(""); }
  }

  const n = parseMoney(amount);
  const valid = n !== null && n > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function submit(again: boolean) {
    if (!valid || n === null) return;
    setBusy(true);
    try {
      await add({ data: { lot_id: target === "geral" ? null : target, category, amount: n, date, description: desc.trim() || null } });
      await onSaved();
      toast.success("Custo lançado");
      if (again) { setAmount(""); setDesc(""); } else onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lançar custo</DialogTitle>
          <DialogDescription>Escolha o lote, ou "Geral da fazenda" para custos de cerca, trator, roçada e outros que servem a todos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Lote</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="geral">Geral da fazenda</SelectItem>
                {lots.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="c-amount">Valor (R$)</Label><Input id="c-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex.: 1.500" /></div>
            <div><Label htmlFor="c-date">Data</Label><Input id="c-date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATTLE_COST_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="c-desc">O que foi (opcional)</Label><Input id="c-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: sal mineral, 20 sacos" autoComplete="off" /></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={!valid || busy} onClick={() => submit(true)}>Salvar e lançar outro</Button>
          <Button className="font-semibold" disabled={!valid || busy} onClick={() => submit(false)}>{busy ? "Salvando..." : "Salvar custo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- venda
function SaleDialog({ open, onOpenChange, lots, costs, sales, initialLot, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; lots: Lot[]; costs: CattleCost[]; sales: CattleSale[]; initialLot: string; onSaved: () => Promise<void>;
}) {
  const add = useServerFn(addCattleSale);
  const [lotId, setLotId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [heads, setHeads] = useState("");
  const [arrobas, setArrobas] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(false);

  const left = (id: string) => { const l = lots.find((x) => x.id === id); return l ? summarizeLot(l, costs, sales, todayIso()).headsLeft : 0; };

  if (open !== seed) {
    setSeed(open);
    if (open) { setLotId(initialLot); setDate(todayIso()); setHeads(String(left(initialLot) || "")); setArrobas(""); setAmount(""); }
  }

  const headsN = Number.parseInt(heads, 10);
  const arrN = arrobas.trim() === "" ? null : parseMoney(arrobas);
  const amountN = parseMoney(amount);
  const valid = lotId !== "" && headsN > 0 && headsN <= left(lotId) && amountN !== null && amountN > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && (arrobas.trim() === "" || (arrN !== null && arrN > 0));
  const perArroba = amountN !== null ? pricePerArroba(amountN, arrN) : null;

  async function submit() {
    if (!valid || amountN === null) return;
    setBusy(true);
    try {
      await add({ data: { lot_id: lotId, date, head_count: headsN, arrobas: arrN, amount: amountN } });
      await onSaved();
      toast.success("Venda registrada");
      onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar venda</DialogTitle>
          <DialogDescription>Pode vender o lote todo ou só parte dele.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Lote</Label>
            <Select value={lotId} onValueChange={(v) => { setLotId(v); setHeads(String(left(v) || "")); }}>
              <SelectTrigger><SelectValue placeholder="Escolha o lote" /></SelectTrigger>
              <SelectContent>{lots.map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({left(l.id)} cab.)</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="s-heads">Cabeças vendidas</Label><Input id="s-heads" inputMode="numeric" value={heads} onChange={(e) => setHeads(e.target.value.replace(/\D/g, ""))} /></div>
            <div><Label htmlFor="s-date">Data</Label><Input id="s-date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="s-amount">Valor total (R$)</Label><Input id="s-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex.: 45.000" /></div>
            <div><Label htmlFor="s-arr">Arrobas (@), se souber</Label><Input id="s-arr" inputMode="decimal" value={arrobas} onChange={(e) => setArrobas(e.target.value)} placeholder="Ex.: 150" /></div>
          </div>
          {perArroba !== null && <p className="text-sm text-muted-foreground">Preço por arroba: <b>{BRL.format(perArroba)}</b></p>}
          {headsN > left(lotId) && lotId !== "" && <p className="text-sm font-medium text-amber-700">Este lote só tem {left(lotId)} cabeças na fazenda.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="font-semibold" disabled={!valid || busy} onClick={submit}>{busy ? "Salvando..." : "Registrar venda"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
