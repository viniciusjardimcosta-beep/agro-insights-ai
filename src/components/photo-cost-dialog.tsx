import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { importCosts } from "@/lib/data.functions";
import { addCattleCosts } from "@/lib/cattle.functions";
import { getPhotoUsage, readNotebookPhoto } from "@/lib/photo.functions";
import { COST_CATEGORY_NAMES } from "@/lib/cost-import";
import { lastTarget } from "@/lib/last-used";
import { BRL } from "@/lib/calc";
import { isAlreadyLogged, type NotebookItem } from "@/lib/notebook-photo";
import type { ExistingCost } from "@/lib/cost-import";

type FieldLite = { id: string; name: string };
type CostLite = { field_id: string; date: string; category: string; amount: number | string };
// picked null = ainda não mexeu: vale "marcado, exceto se parecer já lançado".
type Row = NotebookItem & { picked: boolean | null; amountStr: string };

const MAX_SIDE = 1600;

/** Reduz a foto no próprio celular (lado maior 1600 px, JPEG) para enviar rápido e gastar pouco. Devolve base64 puro. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return url.slice(url.indexOf(",") + 1);
}

export function PhotoCostDialog({
  open,
  onOpenChange,
  fields,
  costs,
  cattle = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fields: FieldLite[];
  costs: CostLite[];
  /** Pecuária: "fields" são lotes, "todos" vira custo geral da fazenda e o salvamento vai para a pecuária. */
  cattle?: boolean;
}) {
  const addCattle = useServerFn(addCattleCosts);
  const qc = useQueryClient();
  const read = useServerFn(readNotebookPhoto);
  const usage = useServerFn(getPhotoUsage);
  const save = useServerFn(importCosts);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ignored, setIgnored] = useState(0);
  const [preview, setPreview] = useState<string | null>(null); // a própria foto, para comparar com a lista
  const [zoom, setZoom] = useState(false);
  const [target, setTarget] = useState("");
  const [used, setUsed] = useState<{ used: number; limit: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    usage().then(setUsed).catch(() => setUsed(null));
    setTarget((t) => t || (cattle ? "" : lastTarget(fields.map((f) => f.id))) || (fields.length === 1 ? fields[0].id : ""));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setRows(null); setIgnored(0); setReading(false); setBusy(false); setPreview(null); setZoom(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const image = await shrink(file);
      const r = await read({ data: { image } });
      setUsed({ used: r.used, limit: r.limit });
      setPreview(`data:image/jpeg;base64,${image}`);
      setZoom(false);
      setIgnored(r.ignored);
      setRows(r.items.map((i) => ({ ...i, picked: null, amountStr: String(i.amount).replace(".", ",") })));
      if (r.items.length === 0) toast.message("Não achei lançamentos nessa foto. Tente com mais luz e a página inteira.");
    } catch (e) {
      toast.error((e as Error).message || "Não consegui ler essa foto.");
    } finally {
      setReading(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const existing: ExistingCost[] = useMemo(
    () => costs.map((c) => ({ field_id: c.field_id, date: c.date, category: c.category, amount: Number(c.amount) })),
    [costs],
  );
  const dup = (rows ?? []).map((r) => isAlreadyLogged({ date: r.date, category: r.category, amount: num(r.amountStr) }, cattle && target === "all" ? "geral" : target, existing));
  const isPicked = (r: Row, i: number) => (r.picked === null ? !dup[i] : r.picked);
  const chosen = (rows ?? []).filter((r, i) => isPicked(r, i) && num(r.amountStr) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  const total = chosen.reduce((s, r) => s + num(r.amountStr), 0);
  const canSave = chosen.length > 0 && target !== "" && !busy;

  function patch(i: number, p: Partial<Row>) {
    setRows((rs) => (rs ?? []).map((r, k) => (k === i ? { ...r, ...p } : r)));
  }

  async function confirm() {
    if (!canSave) return;
    setBusy(true);
    try {
      if (cattle) {
        const out = await addCattle({
          data: { rows: chosen.map((r) => ({ lot_id: target === "all" ? null : target, category: r.category, description: r.description || null, amount: num(r.amountStr), date: r.date })) },
        });
        await qc.invalidateQueries();
        toast.success(`${out.lines} lançamento(s) salvos`);
        reset();
        onOpenChange(false);
        return;
      }
      const out = await save({
        data: {
          source: "foto",
          rows: chosen.map((r) => ({
            target,
            category: r.category,
            description: r.description || null,
            amount: num(r.amountStr),
            date: r.date,
          })),
        },
      });
      await qc.invalidateQueries();
      toast.success(`${out.lines} lançamento(s) salvos`);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error("Erro ao salvar", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cattle ? "Lançar custos da pecuária pela foto do caderno" : "Lançar custos pela foto do caderno"}</DialogTitle>
          <DialogDescription>
            Tire uma foto da página (ou escolha uma da galeria). O app lê o que está escrito e você confere antes de salvar. A foto não fica guardada.
          </DialogDescription>
        </DialogHeader>

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

        {rows === null ? (
          <div className="space-y-3">
            <Button size="lg" className="h-16 w-full text-lg font-semibold" disabled={reading} onClick={() => cameraRef.current?.click()}>
              {reading ? <><Loader2 className="mr-2 h-6 w-6 animate-spin" />Lendo o caderno...</> : <><Camera className="mr-2 h-6 w-6" />Tirar foto do caderno</>}
            </Button>
            <Button variant="outline" className="w-full" disabled={reading} onClick={() => galleryRef.current?.click()}>
              <ImageIcon className="mr-2 h-4 w-4" />Escolher foto da galeria
            </Button>
            <p className="text-sm text-muted-foreground">Dica: página inteira na foto, com boa luz e sem sombra. Valor e data escritos juntos ajudam.</p>
            {used && <p className="text-xs text-muted-foreground">Leituras de foto nos últimos 30 dias: {used.used} de {used.limit}.</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {preview && (
              <div className="sticky top-0 z-10 -mx-1 rounded-lg border bg-background p-1 shadow-sm">
                <button type="button" onClick={() => setZoom((z) => !z)} className="block w-full" aria-label={zoom ? "Diminuir a foto" : "Ampliar a foto"}>
                  <img src={preview} alt="Foto do caderno" className={`mx-auto w-full object-contain ${zoom ? "max-h-[70vh]" : "max-h-32"}`} />
                </button>
                <p className="px-1 pt-1 text-center text-xs text-muted-foreground">Confira os valores com o caderno. Toque na foto para {zoom ? "diminuir" : "ampliar"}.</p>
              </div>
            )}
            {rows.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium">{cattle ? "Lote (vale para todos os itens)" : "Talhão (vale para todos os itens)"}</p>
                <div className="flex flex-wrap gap-2">
                  {fields.map((f) => (
                    <Button key={f.id} type="button" size="sm" variant={target === f.id ? "default" : "outline"} onClick={() => setTarget(f.id)}>{f.name}</Button>
                  ))}
                  <Button type="button" size="sm" variant={target === "all" ? "default" : "outline"} onClick={() => setTarget("all")}>{cattle ? "Geral da fazenda" : "Todos (pela área)"}</Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className={`rounded-lg border p-3 ${isPicked(r, i) ? "" : "opacity-50"}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox checked={isPicked(r, i)} onCheckedChange={(v) => patch(i, { picked: v === true })} className="mt-2" aria-label="Importar este item" />
                    <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                      <Input className="col-span-2 sm:col-span-4" value={r.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder="Descrição" />
                      <Input inputMode="decimal" value={r.amountStr} onChange={(e) => patch(i, { amountStr: e.target.value })} aria-label="Valor" />
                      <Input type="date" value={r.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => patch(i, { date: e.target.value, dateFound: true })} aria-label="Data" />
                      <div className="col-span-2">
                        <Select value={r.category} onValueChange={(v) => patch(i, { category: v, categoryConfident: true })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{COST_CATEGORY_NAMES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  {dup[i] && (
                    <p className="mt-2 pl-8 text-xs font-medium text-amber-700">Parece já lançado (mesma data, categoria e valor). Deixei desmarcado; marque se for outro lançamento.</p>
                  )}
                  {(!r.dateFound || !r.categoryConfident) && (
                    <p className="mt-2 pl-8 text-xs font-medium text-amber-700">
                      {[!r.dateFound ? "Sem data no caderno: usei hoje, confira" : "", !r.categoryConfident ? "Categoria incerta, confira" : ""].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              ))}
              {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lançamento encontrado.</p>}
            </div>

            {ignored > 0 && <p className="text-xs text-muted-foreground">{ignored} item(ns) sem valor legível foram deixados de fora. Lance esses à mão.</p>}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={reset}>Ler outra foto</Button>
              <Button size="lg" className="font-semibold" disabled={!canSave} onClick={confirm}>
                {busy ? "Salvando..." : target === "" && chosen.length > 0 ? (cattle ? "Escolha o lote" : "Escolha o talhão") : `Salvar ${chosen.length} lançamento(s) · ${BRL.format(total)}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
