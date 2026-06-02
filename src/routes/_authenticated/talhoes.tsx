import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listFields, upsertField, deleteField, listProperties } from "@/lib/data.functions";
import { CROPS, NUM } from "@/lib/calc";

const qFields = queryOptions({ queryKey: ["fields"], queryFn: () => listFields() });
const qProps = queryOptions({ queryKey: ["properties"], queryFn: () => listProperties() });

export const Route = createFileRoute("/_authenticated/talhoes")({
  head: () => ({ meta: [{ title: "Talhões — AgroIntel AI" }] }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(qFields),
      context.queryClient.ensureQueryData(qProps),
    ]);
  },
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{error.message}</p>,
});

type Field = {
  id: string; property_id: string; name: string; area: number; crop: string;
  season: string | null; planting_date: string | null;
  estimated_yield: number | null; real_yield: number | null;
  properties?: { name: string } | null;
};

function Page() {
  const { data: fields } = useSuspenseQuery(qFields);
  const { data: props } = useSuspenseQuery(qProps);
  const qc = useQueryClient();
  const save = useServerFn(upsertField);
  const del = useServerFn(deleteField);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Field | null>(null);
  const [propertyId, setPropertyId] = useState<string>("");
  const [crop, setCrop] = useState<string>("soja");

  function openNew() {
    if (props.length === 0) { toast.error("Cadastre uma propriedade primeiro"); return; }
    setEditing(null);
    setPropertyId(props[0].id);
    setCrop("soja");
    setOpen(true);
  }
  function openEdit(f: Field) {
    setEditing(f); setPropertyId(f.property_id); setCrop(f.crop); setOpen(true);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await save({
        data: {
          id: editing?.id,
          property_id: propertyId,
          name: String(fd.get("name")),
          area: Number(fd.get("area") || 0),
          crop,
          season: String(fd.get("season") || "") || null,
          planting_date: String(fd.get("planting_date") || "") || null,
          estimated_yield: fd.get("estimated_yield") ? Number(fd.get("estimated_yield")) : null,
          real_yield: fd.get("real_yield") ? Number(fd.get("real_yield")) : null,
        },
      });
      setOpen(false);
      await qc.invalidateQueries();
      toast.success("Talhão salvo");
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); }
  }

  async function onDelete(id: string) {
    if (!confirm("Excluir este talhão? Os custos vinculados serão removidos.")) return;
    await del({ data: { id } });
    await qc.invalidateQueries();
    toast.success("Excluído");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Talhões</h1>
          <p className="text-sm text-muted-foreground">Cada talhão é uma área com cultura e safra.</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Novo talhão</Button>
      </div>

      {props.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Cadastre uma <Link to="/propriedades" className="text-primary underline">propriedade</Link> antes de criar talhões.
          </CardContent>
        </Card>
      )}

      {fields.length === 0 ? (
        props.length > 0 && (
          <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Nenhum talhão cadastrado.</CardContent></Card>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(fields as Field[]).map((f) => (
            <Card key={f.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{f.properties?.name}</p>
                    <h3 className="text-lg font-semibold">{f.name}</h3>
                    <p className="text-sm capitalize text-primary">{f.crop} · {f.season ?? "—"}</p>
                    <p className="mt-2 text-sm">{NUM.format(Number(f.area))} ha · {f.estimated_yield ? `${NUM.format(Number(f.estimated_yield))} sc/ha est.` : "yield não informado"}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(f)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => onDelete(f.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} talhão</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Propriedade</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {props.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Nome</Label><Input name="name" required defaultValue={editing?.name} /></div>
              <div className="space-y-2"><Label>Área (ha)</Label><Input name="area" type="number" step="0.01" min="0" required defaultValue={editing?.area} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cultura</Label>
                <Select value={crop} onValueChange={setCrop}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CROPS.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Safra</Label><Input name="season" placeholder="2025/2026" defaultValue={editing?.season ?? ""} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>Plantio</Label><Input name="planting_date" type="date" defaultValue={editing?.planting_date ?? ""} /></div>
              <div className="space-y-2"><Label>Yield est. (sc/ha)</Label><Input name="estimated_yield" type="number" step="0.01" min="0" defaultValue={editing?.estimated_yield ?? ""} /></div>
              <div className="space-y-2"><Label>Yield real (sc/ha)</Label><Input name="real_yield" type="number" step="0.01" min="0" defaultValue={editing?.real_yield ?? ""} /></div>
            </div>
            <DialogFooter><Button type="submit">Salvar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}