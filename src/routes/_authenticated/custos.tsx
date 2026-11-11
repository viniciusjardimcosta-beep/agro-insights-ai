import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Camera, Copy, FileSpreadsheet, Mic, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { lastCategory, lastTarget, rememberLast } from "@/lib/last-used";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCosts, upsertCost, createCostSplit, deleteCost, undoImportedCosts, listFields } from "@/lib/data.functions";
import { BRL, COST_CATEGORIES } from "@/lib/calc";
import { splitByArea } from "@/lib/cost-split";
import { formatDateBR } from "@/lib/format-pt";
import { CostImportDialog } from "@/components/cost-import-dialog";
import { VoiceCostDialog } from "@/components/voice-cost-dialog";
import { PhotoCostDialog } from "@/components/photo-cost-dialog";
import { IMPORT_NOTE_MARK } from "@/lib/cost-import";

const qCosts = queryOptions({ queryKey: ["costs"], queryFn: () => listCosts() });
const qFields = queryOptions({ queryKey: ["fields"], queryFn: () => listFields() });

export const Route = createFileRoute("/_authenticated/custos")({
  head: () => ({ meta: [{ title: "Custos — AgroIntel AI" }] }),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{(error as Error).message}</p>,
});

type Cost = { created_at?: string; id: string; field_id: string; category: string; description: string | null; amount: number; date: string; notes: string | null; fields?: { name: string; crop: string } | null };

function Page() {
  const { data: costs = [], isLoading: loadingCosts, error: costsError } = useQuery(qCosts);
  const { data: fields = [], isLoading: loadingFields, error: fieldsError } = useQuery(qFields);
  const qc = useQueryClient();
  const save = useServerFn(upsertCost);
  const saveSplit = useServerFn(createCostSplit);
  const del = useServerFn(deleteCost);
  const undo = useServerFn(undoImportedCosts);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [editing, setEditing] = useState<Cost | null>(null);
  // "Repetir": novo lançamento que começa igual a outro (sem data e sem observação).
  const [template, setTemplate] = useState<Cost | null>(null);
  // "all" = ratear entre todos; "crop:Soja" = ratear entre os talhões da cultura; senão, o id de um talhão.
  const [target, setTarget] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const [formKey, setFormKey] = useState(0);
  const [category, setCategory] = useState<string>(COST_CATEGORIES[0]);

  function openNew() {
    if (fields.length === 0) { toast.error("Cadastre um talhão primeiro"); return; }
    setEditing(null); setTemplate(null);
    setTarget(lastTarget(fields.map((f) => f.id)) ?? fields[0].id);
    setCategory(lastCategory(COST_CATEGORIES) ?? COST_CATEGORIES[0]);
    setAmountStr(""); setFormKey((k) => k + 1); setOpen(true);
  }
  function openRepeat(c: Cost) {
    setEditing(null); setTemplate(c); setTarget(c.field_id); setCategory(c.category); setAmountStr(String(c.amount)); setFormKey((k) => k + 1); setOpen(true);
  }
  function openEdit(c: Cost) { setEditing(c); setTemplate(null); setTarget(c.field_id); setCategory(c.category); setAmountStr(String(c.amount)); setFormKey((k) => k + 1); setOpen(true); }

  if (loadingCosts || loadingFields) return <p className="text-sm text-muted-foreground">Carregando custos...</p>;
  if (costsError || fieldsError) return <p className="text-sm text-destructive">{(costsError ?? fieldsError)?.message}</p>;

  // Rateio: só em lançamento novo e quando o destino é "todos" ou "todos de uma cultura".
  const isSplit = !editing && (target === "all" || target.startsWith("crop:"));
  const splitFields = !isSplit ? [] : target === "all" ? fields : fields.filter((f) => `crop:${f.crop}` === target);
  const preview = isSplit
    ? splitByArea(Number(amountStr) || 0, splitFields.map((f) => ({ id: f.id, area: Number(f.area) })))
    : [];
  const withoutArea = splitFields.filter((f) => !(Number(f.area) > 0)).length;
  const cropsWithMany = [...new Set(fields.map((f) => f.crop))].filter((c) => fields.filter((f) => f.crop === c).length >= 2);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const again = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "again";
    const common = {
      category,
      description: String(fd.get("description") || "") || null,
      amount: Number(amountStr || 0),
      date: String(fd.get("date")),
      notes: String(fd.get("notes") || "") || null,
    };
    try {
      if (isSplit) {
        const r = await saveSplit({ data: { ...common, field_ids: splitFields.map((f) => f.id) } });
        toast.success(`Custo dividido entre ${r.count} talhões`);
      } else {
        await save({ data: { ...common, id: editing?.id, field_id: target } });
        toast.success("Custo lançado");
      }
      rememberLast(target, category);
      await qc.invalidateQueries();
      if (again) { setAmountStr(""); setFormKey((k) => k + 1); } else { setOpen(false); }
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); }
  }

  async function onDelete(id: string) {
    if (!confirm("Excluir este lançamento?")) return;
    await del({ data: { id } });
    await qc.invalidateQueries();
    toast.success("Excluído");
  }

  const isImported = (c: Cost) => !!c.notes && c.notes.includes(IMPORT_NOTE_MARK);
  // Uma importação grava tudo de uma vez, então todas as linhas dela têm o mesmo created_at.
  const imported = (costs as Cost[]).filter((c) => isImported(c) && c.created_at);
  const lastStamp = imported.reduce<string>((m, c) => (c.created_at! > m ? c.created_at! : m), "");
  const lastImport = lastStamp ? imported.filter((c) => c.created_at === lastStamp) : [];

  async function onUndoImport() {
    const sum = lastImport.reduce((s, c) => s + Number(c.amount), 0);
    if (!confirm(`Desfazer a última importação?\n\n${lastImport.length} lançamento(s), total ${BRL.format(sum)}, serão excluídos. Lançamentos feitos à mão não são afetados.`)) return;
    try {
      const r = await undo({ data: { ids: lastImport.map((c) => c.id) } });
      await qc.invalidateQueries();
      toast.success(`${r.count} lançamento(s) da importação excluído(s)`);
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Custos</h1>
          <p className="text-sm text-muted-foreground">Lançamentos por talhão e categoria, ou divididos entre os talhões pela área.</p>
        </div>
        <div className="w-full space-y-2 md:w-auto">
          <div className="grid grid-cols-2 gap-2 md:flex">
            <Button className="col-span-2 font-semibold md:col-span-1" disabled={fields.length === 0} onClick={() => setVoiceOpen(true)}>
              <Mic className="mr-2 h-4 w-4" />Falar custo
            </Button>
            <Button variant="outline" disabled={fields.length === 0} onClick={() => setPhotoOpen(true)}>
              <Camera className="mr-2 h-4 w-4" />Foto do caderno
            </Button>
            <Button variant="outline" disabled={fields.length === 0} onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />Importar planilha
            </Button>
            <Button variant="outline" onClick={openNew}><Plus className="mr-2 h-4 w-4" />Novo custo</Button>
          </div>
          {lastImport.length > 0 && (
            <button type="button" onClick={onUndoImport} className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline md:ml-auto">
              <Undo2 className="h-3.5 w-3.5" />Desfazer última importação ({lastImport.length})
            </button>
          )}
        </div>
      </div>

      {fields.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Cadastre um <Link to="/talhoes" className="text-primary underline">talhão</Link> antes de lançar custos.
          </CardContent>
        </Card>
      ) : costs.length === 0 ? (
        <Card className="border-dashed border-primary/40 bg-primary/5">
          <CardContent className="space-y-4 py-10 text-center">
            <p className="text-lg font-semibold">Lance o seu primeiro custo</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              O jeito mais rápido é falar. Toque no botão e diga, por exemplo: <b>“diesel 450 reais ontem”</b>.
            </p>
            <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button size="lg" className="font-semibold" disabled={fields.length === 0} onClick={() => setVoiceOpen(true)}><Mic className="mr-2 h-5 w-5" />Falar custo</Button>
              <Button size="lg" variant="outline" disabled={fields.length === 0} onClick={openNew}><Plus className="mr-2 h-5 w-5" />Digitar custo</Button>
            </div>
            <p className="text-xs text-muted-foreground">Também dá para fotografar o caderno ou importar uma planilha, nos botões lá em cima.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Talhão</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="hidden md:table-cell">Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(costs as Cost[]).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap px-2 text-xs text-muted-foreground md:px-4">{formatDateBR(c.date)}</TableCell>
                    <TableCell className="whitespace-nowrap px-2 font-medium md:px-4">{c.fields?.name ?? "-"}</TableCell>
                    <TableCell>{c.category}</TableCell>
                    <TableCell className="hidden max-w-xs truncate md:table-cell text-sm text-muted-foreground" title={c.description || c.notes || undefined}>
                      {isImported(c) && <span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">Importado</span>}
                      {c.description || (c.notes ? <span className="italic">{c.notes}</span> : null)}
                    </TableCell>
                    <TableCell className="text-right font-medium">{BRL.format(Number(c.amount))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" title="Repetir este lançamento" aria-label="Repetir este lançamento" onClick={() => openRepeat(c)}><Copy className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => onDelete(c.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <VoiceCostDialog open={voiceOpen} onOpenChange={setVoiceOpen} fields={fields} />
      <PhotoCostDialog open={photoOpen} onOpenChange={setPhotoOpen} fields={fields} />
      <CostImportDialog open={importOpen} onOpenChange={setImportOpen} fields={fields} costs={costs as Cost[]} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : template ? "Repetir" : "Novo"} lançamento de custo</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Talhão</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!editing && fields.length > 1 && (
                    <>
                      <SelectItem value="all">Todos os talhões (dividir pela área)</SelectItem>
                      {cropsWithMany.map((c) => (
                        <SelectItem key={c} value={`crop:${c}`}>Todos de {c} (dividir pela área)</SelectItem>
                      ))}
                    </>
                  )}
                  {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} ({f.crop})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COST_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>{isSplit ? "Valor total (R$)" : "Valor (R$)"}</Label><Input name="amount" type="number" step="0.01" min="0" required autoFocus value={amountStr} onChange={(e) => setAmountStr(e.target.value)} /></div>
            </div>
            {isSplit && (
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground" aria-live="polite">
                {preview.length === 0 ? (
                  <p>{withoutArea === splitFields.length && splitFields.length > 0
                    ? "Os talhões escolhidos não têm área cadastrada; informe a área para dividir."
                    : "Informe o valor para ver como ele será dividido."}</p>
                ) : (
                  <>
                    <p className="mb-1 font-medium text-foreground">Divisão proporcional à área:</p>
                    <ul className="space-y-0.5">
                      {preview.map((s) => {
                        const f = splitFields.find((x) => x.id === s.field_id)!;
                        return <li key={s.field_id}>{f.name} ({Number(f.area)} ha): {BRL.format(s.amount)}</li>;
                      })}
                    </ul>
                    {withoutArea > 0 && <p className="mt-1">{withoutArea} talhão(ões) sem área ficam de fora.</p>}
                    <p className="mt-1">Cada talhão recebe um lançamento próprio; para corrigir depois, edite ou exclua cada um.</p>
                  </>
                )}
              </div>
            )}
            <div className="space-y-2"><Label>Descrição</Label><Input key={`d${formKey}`} name="description" defaultValue={(editing ?? template)?.description ?? ""} /></div>
            <div className="space-y-2"><Label>Data</Label><Input name="date" type="date" required defaultValue={editing?.date ?? today} /></div>
            <div className="space-y-2"><Label>Observação</Label><Textarea key={`n${formKey}`} name="notes" defaultValue={editing?.notes ?? ""} /></div>
            <DialogFooter>
              <Button type="submit" name="intent" value="close">Salvar</Button>
              {!editing && <Button type="submit" name="intent" value="again" variant="outline">Salvar e lançar outro</Button>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}