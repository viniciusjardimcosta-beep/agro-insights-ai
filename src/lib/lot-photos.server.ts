// Apaga as fotos de um lote (ou de todos os lotes de uma conta): arquivos e linhas. Melhor esforço:
// se a migração das fotos ainda não foi aplicada, não há nada a apagar e o resto segue normalmente.
export const LOT_PHOTOS_BUCKET = "lot-photos";

export async function removeLotPhotos(sb: any, scope: { lotId?: string; userId?: string }): Promise<void> {
  let q = sb.from("cattle_lot_photos").select("id, path");
  if (scope.lotId) q = q.eq("lot_id", scope.lotId);
  if (scope.userId) q = q.eq("user_id", scope.userId);
  const { data, error } = await q;
  if (error || !data || data.length === 0) return;
  const rows = data as { id: string; path: string }[];
  await sb.storage.from(LOT_PHOTOS_BUCKET).remove(rows.map((r) => r.path));
  await sb.from("cattle_lot_photos").delete().in("id", rows.map((r) => r.id));
}
