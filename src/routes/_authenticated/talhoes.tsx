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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listFields, upsertField, deleteField, listProperties } from "@/lib/data.functions";
import { CROPS, NUM } from "@/lib/calc";
import { useFarm } from "@/lib/farm-selection";

const qFields = queryOptions({ queryKey: ["fields"], queryFn: () => listFields() });
const qProps = queryOptions({ queryKey: ["properties"], queryFn: () => listProperties() });

export const Route = createFileRoute("/_authenticated/talhoes")({
  head: () => ({ meta: [{ title: "Talhões — AgroIntel AI" }] }),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{(error as Error).message}</p>,
});

type Field = {
  id: string; property_id: string; name: string; area: number; crop: string;
  season: string | null; planting_date: string | null;
  estimated_yield: number | null; real_yield: number | null;
  properties?: { name: string } | null;
};

function Page() {
  const { data: allFields = [], isLoading: loadingFields, error: fieldsError } = useQuery(qFields);
  const farm = useFarm();
  const fields = farm.selected ? (allFields as Field[]).filter((f) => f.property_id === farm.selected!.id) : allFields;
  const { data: props = [], isLoading: loadingProps, error: propsError } = useQuery(qProps);
  const qc = useQueryClient();
  const save = useServerFn(upsertField);
  const del = useServerFn(deleteField);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Field | null>(null);
  const [propertyId, setPropertyId] = useState<string>("");
  const [crop, setCrop] = useState<string>("soja");
  const [areaTxt, setAreaTxt] = useState("");

  function openNew() {
    if (props.length === 0) { toast.error("Cadastre uma fazenda primeiro"); return; }
    setEditing(null);
    setPropertyId(farm.selected?.id ?? props[0].id);
    setCrop("soja");
    setAreaTxt("");
    setOpen(true);
  }
  function openEdit(f: Field) {
    setEditing(f); setPropertyId(f.property_id); setCrop(f.crop); setAreaTxt(String(f.area ?? "")); setOpen(true);
  }

  if (loadingFields || loadingProps) return <p className="text-sm text-muted-foreground">Carregando talhões...</p>;
  if (fieldsError || propsError) return <p className="text-sm text-destructive">{(fieldsError ?? propsError)?.message}</p>;

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
            Cadastre uma <Link to="/propriedades" className="text-primary underline">fazenda</Link> antes de criar talhões.
          </CardContent>
        </Card>
      )}

      {fields.length === 0 ? (
        props.length > 0 && (
          <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">{farm.selected ? "Esta fazenda ainda não tem talhões." : "Nenhum talhão cadastrado."}</CardContent></Card>
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
                    <p className="mt-2 text-sm">{NUM.format(Number(f.area))} ha · {f.estimated_yield ? `${NUM.format(Number(f.estimated_yield))} sc/ha est.` : "produtividade não informada"}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => openEdit(f)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => onDelete(f.id)}><Trash2 className="h-4 w-4" /></Button>
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
              <Label>Fazenda</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {props.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="ta-name">Nome</Label><Input id="ta-name" name="name" required defaultValue={editing?.name} /></div>
              <div className="space-y-2"><Label htmlFor="ta-area">Área (ha)</Label><Input id="ta-area" name="area" type="number" step="0.01" min="0.01" required defaultValue={editing?.area} onChange={(e) => setAreaTxt(e.target.value)} /></div>
            </div>
            {(() => {
              const total = Number((props.find((p) => p.id === propertyId) as { total_area?: number | string | null } | undefined)?.total_area ?? 0);
              const others = (allFields as Field[]).filter((f) => f.property_id === propertyId && f.id !== editing?.id).reduce((a, f) => a + Number(f.area ?? 0), 0);
              const sum = others + Number(areaTxt || 0);
              return total > 0 && sum > total ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Atenção: esta fazenda tem {total} ha cadastrados e os talhões somariam {Math.round(sum * 100) / 100} ha. Confira a área.
                </p>
              ) : null;
            })()}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cultura</Label>
                <Select value={crop} onValueChange={setCrop}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CROPS.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label htmlFor="ta-season">Safra</Label><Input id="ta-season" name="season" placeholder="2025/2026" defaultValue={editing?.season ?? ""} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label htmlFor="ta-planting_date">Plantio</Label><Input id="ta-planting_date" name="planting_date" type="date" defaultValue={editing?.planting_date ?? ""} /></div>
              <div className="space-y-2"><Label htmlFor="ta-estimated_yield">Produtividade estimada (sc/ha)</Label><Input id="ta-estimated_yield" name="estimated_yield" type="number" step="0.01" min="0" defaultValue={editing?.estimated_yield ?? ""} /></div>
              <div className="space-y-2"><Label htmlFor="ta-real_yield">Produtividade real (sc/ha)</Label><Input id="ta-real_yield" name="real_yield" type="number" step="0.01" min="0" defaultValue={editing?.real_yield ?? ""} /></div>
            </div>
            <DialogFooter><Button type="submit">Salvar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}