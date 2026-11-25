import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Link } from "@tanstack/react-router";
import { listFields, listProperties, upsertProperty, deleteProperty } from "@/lib/data.functions";
import { createSubmitLock } from "@/lib/submit-lock";
import { NUM } from "@/lib/calc";
import { getActivities, setActivities } from "@/lib/cattle.functions";
import { accountFlagsFor, FARM_ACTIVITIES, FARM_ACTIVITY_LABEL, isFarmActivity, type FarmActivity } from "@/lib/farms";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const q = queryOptions({ queryKey: ["properties"], queryFn: () => listProperties() });
const qFields = queryOptions({ queryKey: ["fields"], queryFn: () => listFields() });

export const Route = createFileRoute("/_authenticated/propriedades")({
  head: () => ({ meta: [{ title: "Fazendas — AgroIntel AI" }] }),
  component: Page,
  errorComponent: ({ error }) => <p className="text-destructive">{(error as Error).message}</p>,
});

type Prop = { id: string; name: string; city: string | null; state: string | null; total_area: number; activity?: string | null };

const submitLock = createSubmitLock();

function Page() {
  const { data = [], isLoading, error } = useQuery(q);
  const { data: fields = [] } = useQuery(qFields);
  const fieldsByFarm = new Map<string, number>();
  for (const f of fields as { property_id: string }[]) fieldsByFarm.set(f.property_id, (fieldsByFarm.get(f.property_id) ?? 0) + 1);
  const qc = useQueryClient();
  const save = useServerFn(upsertProperty);
  const del = useServerFn(deleteProperty);
  const saveActivities = useServerFn(setActivities);
  const activitiesQ = useQuery({ queryKey: ["activities"], queryFn: () => getActivities(), staleTime: 300_000 });
  const account = { lavoura: activitiesQ.data?.lavoura ?? true, pecuaria: activitiesQ.data?.pecuaria ?? false };
  const [activity, setActivity] = useState<FarmActivity>("plantio");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Prop | null>(null);

  const accountDefault: FarmActivity = account.lavoura && account.pecuaria ? "ilp" : account.pecuaria ? "pecuaria" : "plantio";
  function openNew() { setEditing(null); setActivity(accountDefault); setOpen(true); }
  function openEdit(p: Prop) { setEditing(p); setActivity(isFarmActivity(p.activity) ? p.activity : accountDefault); setOpen(true); }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando fazendas...</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!submitLock.take()) return; // duplo toque: o segundo é ignorado
    try {
      await save({
        data: {
          id: editing?.id,
          name: String(fd.get("name")),
          city: String(fd.get("city") || "") || null,
          state: String(fd.get("state") || "").toUpperCase().slice(0, 2) || null,
          total_area: Number(fd.get("total_area") || 0),
          activity,
        },
      });
      // Fazenda de pecuária (ou ILP) numa conta só de plantio: liga a Pecuária no menu. Nunca desliga nada.
      const next = accountFlagsFor(activity, account);
      if (next.lavoura !== account.lavoura || next.pecuaria !== account.pecuaria) {
        await saveActivities({ data: next });
        await qc.invalidateQueries({ queryKey: ["activities"] });
      }
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ["properties"] });
      await qc.invalidateQueries({ queryKey: ["farm-snapshot"] });
      toast.success("Fazenda salva");
    } catch (e) { toast.error("Erro", { description: (e as Error).message }); } finally { submitLock.release(); }
  }

  async function onDelete(id: string) {
    if (!confirm("Excluir esta fazenda? Talhões e custos vinculados também serão excluídos.")) return;
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
          <h1 className="text-3xl font-bold">Fazendas</h1>
          <p className="text-sm text-muted-foreground">Suas fazendas e áreas totais.</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Nova fazenda</Button>
      </div>

      {data.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Nenhuma fazenda cadastrada.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data as Prop[]).map((p) => (
            <Card key={p.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    <p className="text-sm text-muted-foreground">{[p.city, p.state].filter(Boolean).join(" / ") || "Local não informado"}</p>
                    <p className="mt-2 text-sm"><span className="font-medium">{NUM.format(Number(p.total_area))}</span> ha{isFarmActivity(p.activity) ? ` · ${FARM_ACTIVITY_LABEL[p.activity]}` : ""}</p>
                    {(fieldsByFarm.get(p.id) ?? 0) === 0 && p.activity !== "pecuaria" && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Sem talhões. Se for plantio, <Link to="/talhoes" className="text-primary underline">cadastre o talhão</Link> para esta área entrar no Dashboard.
                      </p>
                    )}
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
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} fazenda</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label>Nome</Label><Input name="name" required defaultValue={editing?.name} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Município</Label><Input name="city" defaultValue={editing?.city ?? ""} /></div>
              <div className="space-y-2"><Label>Estado (UF)</Label><Input name="state" maxLength={2} defaultValue={editing?.state ?? ""} /></div>
            </div>
            <div className="space-y-2">
              <Label>O que você faz nesta fazenda?</Label>
              <Select value={activity} onValueChange={(v) => setActivity(v as FarmActivity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FARM_ACTIVITIES.map((a) => <SelectItem key={a} value={a}>{FARM_ACTIVITY_LABEL[a]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Área total (ha)</Label><Input name="total_area" type="number" step="0.01" min="0" required defaultValue={editing?.total_area} /></div>
            <DialogFooter><Button type="submit">Salvar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}