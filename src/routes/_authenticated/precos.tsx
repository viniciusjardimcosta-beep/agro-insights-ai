import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPrices, upsertPrice, deletePrice } from "@/lib/data.functions";
import { BRL, CROPS } from "@/lib/calc";

const q = queryOptions({ queryKey: ["prices"], queryFn: () => listPrices() });

export const Route = createFileRoute("/_authenticated/precos")({
  head: () => ({ meta: [{ title: "Preços — AgroIntel AI" }] }),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{error.message}</p>,
});

type Price = { id: string; crop: string; price_per_bag: number; date: string };

function Page() {
  const { data = [], isLoading, error } = useQuery(q);
  const qc = useQueryClient();
  const save = useServerFn(upsertPrice);
  const del = useServerFn(deletePrice);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Price | null>(null);
  const [crop, setCrop] = useState<string>("soja");

  function openNew() { setEditing(null); setCrop("soja"); setOpen(true); }
  function openEdit(p: Price) { setEditing(p); setCrop(p.crop); setOpen(true); }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando preços...</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await save({
        data: {
          id: editing?.id,
          crop,
          price_per_bag: Number(fd.get("price_per_bag") || 0),
          date: String(fd.get("date")),
        },
      });
      setOpen(false);
      await qc.invalidateQueries();
      toast.success("Preço salvo");
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); }
  }

  async function onDelete(id: string) {
    if (!confirm("Excluir este preço?")) return;
    await del({ data: { id } });
    await qc.invalidateQueries();
    toast.success("Excluído");
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Preços</h1>
          <p className="text-sm text-muted-foreground">Histórico de preços da saca por cultura. O mais recente é usado nos cálculos.</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Novo preço</Button>
      </div>

      {data.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Nenhum preço cadastrado.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Cultura</TableHead><TableHead className="text-right">R$/saca</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {(data as Price[]).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs text-muted-foreground">{p.date}</TableCell>
                    <TableCell className="capitalize">{p.crop}</TableCell>
                    <TableCell className="text-right font-medium">{BRL.format(Number(p.price_per_bag))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => onDelete(p.id)}><Trash2 className="h-4 w-4" /></Button>
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
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} preço</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Cultura</Label>
              <Select value={crop} onValueChange={setCrop}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CROPS.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>R$ / saca</Label><Input name="price_per_bag" type="number" step="0.01" min="0" required defaultValue={editing?.price_per_bag} /></div>
              <div className="space-y-2"><Label>Data</Label><Input name="date" type="date" required defaultValue={editing?.date ?? today} /></div>
            </div>
            <DialogFooter><Button type="submit">Salvar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}