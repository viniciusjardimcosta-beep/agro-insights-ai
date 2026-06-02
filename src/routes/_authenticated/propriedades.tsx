import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listProperties, upsertProperty, deleteProperty } from "@/lib/data.functions";
import { NUM } from "@/lib/calc";

const q = queryOptions({ queryKey: ["properties"], queryFn: () => listProperties() });

export const Route = createFileRoute("/_authenticated/propriedades")({
  head: () => ({ meta: [{ title: "Propriedades — AgroIntel AI" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{error.message}</p>,
});

type Prop = { id: string; name: string; city: string | null; state: string | null; total_area: number };

function Page() {
  const { data } = useSuspenseQuery(q);
  const qc = useQueryClient();
  const save = useServerFn(upsertProperty);
  const del = useServerFn(deleteProperty);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Prop | null>(null);

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(p: Prop) { setEditing(p); setOpen(true); }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await save({
        data: {
          id: editing?.id,
          name: String(fd.get("name")),
          city: String(fd.get("city") || "") || null,
          state: String(fd.get("state") || "").toUpperCase().slice(0, 2) || null,
          total_area: Number(fd.get("total_area") || 0),
        },
      });
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ["properties"] });
      await qc.invalidateQueries({ queryKey: ["farm-snapshot"] });
      toast.success("Propriedade salva");
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); }
  }

  async function onDelete(id: string) {
    if (!confirm("Excluir esta propriedade? Talhões e custos vinculados também serão excluídos.")) return;
    try {
      await del({ data: { id } });
      await qc.invalidateQueries();
      toast.success("Excluída");
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Propriedades</h1>
          <p className="text-sm text-muted-foreground">Fazendas e áreas totais.</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Nova propriedade</Button>
      </div>

      {data.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Nenhuma propriedade cadastrada.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data as Prop[]).map((p) => (
            <Card key={p.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    <p className="text-sm text-muted-foreground">{[p.city, p.state].filter(Boolean).join(" / ") || "Local não informado"}</p>
                    <p className="mt-2 text-sm"><span className="font-medium">{NUM.format(Number(p.total_area))}</span> ha</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => onDelete(p.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} propriedade</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label>Nome</Label><Input name="name" required defaultValue={editing?.name} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Município</Label><Input name="city" defaultValue={editing?.city ?? ""} /></div>
              <div className="space-y-2"><Label>Estado (UF)</Label><Input name="state" maxLength={2} defaultValue={editing?.state ?? ""} /></div>
            </div>
            <div className="space-y-2"><Label>Área total (ha)</Label><Input name="total_area" type="number" step="0.01" min="0" required defaultValue={editing?.total_area} /></div>
            <DialogFooter><Button type="submit">Salvar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}