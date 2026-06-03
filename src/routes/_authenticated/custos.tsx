import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCosts, upsertCost, deleteCost, listFields } from "@/lib/data.functions";
import { BRL, COST_CATEGORIES } from "@/lib/calc";

const qCosts = queryOptions({ queryKey: ["costs"], queryFn: () => listCosts() });
const qFields = queryOptions({ queryKey: ["fields"], queryFn: () => listFields() });

export const Route = createFileRoute("/_authenticated/custos")({
  head: () => ({ meta: [{ title: "Custos — AgroIntel AI" }] }),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{error.message}</p>,
});

type Cost = { id: string; field_id: string; category: string; description: string | null; amount: number; date: string; notes: string | null; fields?: { name: string; crop: string } | null };

function Page() {
  const { data: costs = [], isLoading: loadingCosts, error: costsError } = useQuery(qCosts);
  const { data: fields = [], isLoading: loadingFields, error: fieldsError } = useQuery(qFields);
  const qc = useQueryClient();
  const save = useServerFn(upsertCost);
  const del = useServerFn(deleteCost);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cost | null>(null);
  const [fieldId, setFieldId] = useState<string>("");
  const [category, setCategory] = useState<string>(COST_CATEGORIES[0]);

  function openNew() {
    if (fields.length === 0) { toast.error("Cadastre um talhão primeiro"); return; }
    setEditing(null); setFieldId(fields[0].id); setCategory(COST_CATEGORIES[0]); setOpen(true);
  }
  function openEdit(c: Cost) { setEditing(c); setFieldId(c.field_id); setCategory(c.category); setOpen(true); }

  if (loadingCosts || loadingFields) return <p className="text-sm text-muted-foreground">Carregando custos...</p>;
  if (costsError || fieldsError) return <p className="text-sm text-destructive">{(costsError ?? fieldsError)?.message}</p>;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await save({
        data: {
          id: editing?.id,
          field_id: fieldId,
          category,
          description: String(fd.get("description") || "") || null,
          amount: Number(fd.get("amount") || 0),
          date: String(fd.get("date")),
          notes: String(fd.get("notes") || "") || null,
        },
      });
      setOpen(false);
      await qc.invalidateQueries();
      toast.success("Custo lançado");
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); }
  }

  async function onDelete(id: string) {
    if (!confirm("Excluir este lançamento?")) return;
    await del({ data: { id } });
    await qc.invalidateQueries();
    toast.success("Excluído");
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Custos</h1>
          <p className="text-sm text-muted-foreground">Lançamentos por talhão e categoria.</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Novo custo</Button>
      </div>

      {fields.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Cadastre um <Link to="/talhoes" className="text-primary underline">talhão</Link> antes de lançar custos.
          </CardContent>
        </Card>
      ) : costs.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Nenhum custo lançado.</CardContent></Card>
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
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{c.date}</TableCell>
                    <TableCell className="font-medium">{c.fields?.name ?? "-"}</TableCell>
                    <TableCell>{c.category}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.description}</TableCell>
                    <TableCell className="text-right font-medium">{BRL.format(Number(c.amount))}</TableCell>
                    <TableCell className="text-right">
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} lançamento de custo</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Talhão</Label>
              <Select value={fieldId} onValueChange={setFieldId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} ({f.crop})</SelectItem>)}</SelectContent>
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
              <div className="space-y-2"><Label>Valor (R$)</Label><Input name="amount" type="number" step="0.01" min="0" required defaultValue={editing?.amount} /></div>
            </div>
            <div className="space-y-2"><Label>Descrição</Label><Input name="description" defaultValue={editing?.description ?? ""} /></div>
            <div className="space-y-2"><Label>Data</Label><Input name="date" type="date" required defaultValue={editing?.date ?? today} /></div>
            <div className="space-y-2"><Label>Observação</Label><Textarea name="notes" defaultValue={editing?.notes ?? ""} /></div>
            <DialogFooter><Button type="submit">Salvar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}