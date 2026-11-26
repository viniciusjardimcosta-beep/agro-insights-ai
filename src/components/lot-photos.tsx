import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createSubmitLock } from "@/lib/submit-lock";

const BUCKET = "lot-photos";
// A tabela é nova e ainda não está nos tipos gerados do banco.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
export const MAX_LOT_PHOTOS = 5;
const MAX_SIDE = 1280;
const submitLock = createSubmitLock();

type Photo = { id: string; path: string; url: string | null };

/** Reduz a foto no próprio celular (lado maior 1280 px, JPEG): fica em ~200–400 KB e não pesa no armazenamento. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a foto.");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível preparar a foto."))), "image/jpeg", 0.8));
}

/** Fotos da compra do lote (até 5). Somem quando o lote é vendido por inteiro ou excluído. */
export function LotPhotos({ lotId }: { lotId: string }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function load() {
    const { data, error } = await db.from("cattle_lot_photos").select("id, path").eq("lot_id", lotId).order("created_at");
    if (error) { setReady(false); return; } // migração ainda não aplicada: o recurso fica escondido
    const rows = (data ?? []) as { id: string; path: string }[];
    const urls = rows.length ? await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600) : { data: [] as { signedUrl: string }[] };
    setPhotos(rows.map((r, i) => ({ ...r, url: urls.data?.[i]?.signedUrl ?? null })));
  }
  useEffect(() => { load(); }, [lotId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0 || !submitLock.take()) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Entre na conta novamente.");
      let count = photos?.length ?? 0;
      for (const f of files) {
        if (count >= MAX_LOT_PHOTOS) { toast.info(`Máximo de ${MAX_LOT_PHOTOS} fotos por lote.`); break; }
        const blob = await shrink(f);
        const path = `${uid}/${lotId}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw new Error("Não foi possível enviar a foto. Tente de novo.");
        const ins = await db.from("cattle_lot_photos").insert({ user_id: uid, lot_id: lotId, path });
        if (ins.error) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw new Error(ins.error.message.includes("Limite") ? `Máximo de ${MAX_LOT_PHOTOS} fotos por lote.` : "Não foi possível salvar a foto.");
        }
        count++;
      }
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      submitLock.release();
      setBusy(false);
    }
  }

  async function remove(p: Photo) {
    if (!confirm("Excluir esta foto?")) return;
    await supabase.storage.from(BUCKET).remove([p.path]);
    await db.from("cattle_lot_photos").delete().eq("id", p.id);
    await load();
  }

  if (!ready || photos === null) return null;
  const full = photos.length >= MAX_LOT_PHOTOS;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative">
            {p.url ? (
              <button type="button" onClick={() => setView(p.url)} aria-label="Ver foto">
                <img src={p.url} alt="Foto do lote" className="h-16 w-16 rounded-md border object-cover" loading="lazy" />
              </button>
            ) : (
              <div className="h-16 w-16 rounded-md border bg-muted" />
            )}
            <button type="button" onClick={() => remove(p)} aria-label="Excluir foto" className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-background text-destructive shadow ring-1 ring-border">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {!full && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            {photos.length === 0 ? "Foto do lote" : "Mais uma foto"}
          </Button>
        )}
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={onPick} />
      </div>
      <p className="text-xs text-muted-foreground">
        Guarde como o gado chegou ({photos.length}/{MAX_LOT_PHOTOS}). As fotos são apagadas quando o lote for vendido por inteiro ou excluído.
      </p>
      {view && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={() => setView(null)}>
          <button type="button" aria-label="Fechar" className="absolute right-4 top-4 text-white"><X className="h-6 w-6" /></button>
          <img src={view} alt="Foto do lote" className="max-h-full max-w-full rounded-md object-contain" />
        </div>
      )}
    </div>
  );
}
