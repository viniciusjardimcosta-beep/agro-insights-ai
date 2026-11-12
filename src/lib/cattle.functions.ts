import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError, isIsoDate } from "@/lib/db-utils";
import { CATTLE_PHASES } from "@/lib/cattle";

const isoDate = z.string().refine(isIsoDate, "Data inválida (use AAAA-MM-DD)");
const NOT_FOUND = "Recurso não encontrado";
const NOT_READY = "A pecuária ainda não está disponível nesta conta.";

/** O banco ainda não tem as tabelas/colunas da pecuária (migração não aplicada). */
function isMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "42703" || error.code === "PGRST205" || error.code === "PGRST204" ||
    /does not exist|schema cache/i.test(error.message ?? "");
}

// ---------------- Atividades do perfil ----------------
/** Quais atividades a pessoa usa. Qualquer falha vira "só lavoura": a pecuária nunca aparece por engano. */
export const getActivities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("profiles").select("activities").eq("id", context.userId).maybeSingle();
    if (error || !data) return { pecuaria: false };
    const list = (data as { activities?: string[] | null }).activities ?? [];
    return { pecuaria: list.includes("pecuaria") };
  });

export const setPecuariaEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const activities = data.enabled ? ["lavoura", "pecuaria"] : ["lavoura"];
    const { error } = await context.supabase.from("profiles").update({ activities }).eq("id", context.userId);
    if (error) {
      if (isMissing(error)) throw new Error(NOT_READY);
      throw dbError(error);
    }
    return { ok: true };
  });

// ---------------- Leitura ----------------
export const listCattle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [lots, costs, sales, losses] = await Promise.all([
      context.supabase.from("cattle_lots").select("*").order("entry_date", { ascending: false }).limit(500),
      context.supabase.from("cattle_costs").select("*").order("date", { ascending: false }).limit(5000),
      context.supabase.from("cattle_sales").select("*").order("date", { ascending: false }).limit(2000),
      context.supabase.from("cattle_losses").select("*").order("date", { ascending: false }).limit(2000),
    ]);
    const err = lots.error ?? costs.error ?? sales.error;
    if (err) {
      if (isMissing(err)) return { ready: false as const, lossesReady: false, lots: [], costs: [], sales: [], losses: [] };
      throw dbError(err);
    }
    // Baixas são uma tabela mais nova: se ainda não existe, o resto da pecuária segue funcionando.
    if (losses.error && !isMissing(losses.error)) throw dbError(losses.error);
    const lossesReady = !losses.error;
    return { ready: true as const, lossesReady, lots: lots.data ?? [], costs: costs.data ?? [], sales: sales.data ?? [], losses: lossesReady ? losses.data ?? [] : [] };
  });

async function ownsLot(context: { supabase: any }, lotId: string): Promise<{ head_count: number; status: string }> {
  const { data } = await context.supabase.from("cattle_lots").select("head_count, status").eq("id", lotId).maybeSingle();
  if (!data) throw new Error(NOT_FOUND);
  return data as { head_count: number; status: string };
}

/** Cabeças já baixadas no lote (0 se a tabela de baixas ainda não existe). */
async function lostHeads(context: { supabase: any }, lotId: string): Promise<number> {
  const { data, error } = await context.supabase.from("cattle_losses").select("head_count").eq("lot_id", lotId);
  if (error) return 0;
  return ((data ?? []) as { head_count: number }[]).reduce((a, l) => a + l.head_count, 0);
}

// ---------------- Lotes ----------------
const lotInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  phase: z.enum(CATTLE_PHASES),
  head_count: z.number().int().min(1).max(100000),
  entry_date: isoDate,
  entry_avg_weight_kg: z.number().gt(0).max(2000).nullable().optional(),
  purchase_amount: z.number().min(0).max(1e12),
  notes: z.string().max(500).nullable().optional(),
});

export const saveLot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => lotInput.parse(input))
  .handler(async ({ context, data }) => {
    if (data.id) {
      await ownsLot(context, data.id);
      const { data: sold } = await context.supabase.from("cattle_sales").select("head_count").eq("lot_id", data.id);
      const headsSold = ((sold ?? []) as { head_count: number }[]).reduce((a, s) => a + s.head_count, 0);
      const headsLost = await lostHeads(context, data.id);
      if (data.head_count < headsSold + headsLost) throw new Error(`Este lote já teve ${headsSold} vendidas e ${headsLost} baixas. A quantidade não pode ser menor que ${headsSold + headsLost}.`);
    }
    const row = { ...data, user_id: context.userId, entry_avg_weight_kg: data.entry_avg_weight_kg ?? null, notes: data.notes ?? null };
    const { error } = await context.supabase.from("cattle_lots").upsert(row);
    if (error) throw dbError(error);
    return { ok: true };
  });

export const deleteLot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await ownsLot(context, data.id);
    const { error } = await context.supabase.from("cattle_lots").delete().eq("id", data.id);
    if (error) throw dbError(error);
    return { ok: true };
  });

// ---------------- Custos ----------------
const costInput = z.object({
  lot_id: z.string().uuid().nullable(), // null = custo geral da fazenda
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  amount: z.number().gt(0).max(1e12),
  date: isoDate,
});

export const addCattleCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => costInput.parse(input))
  .handler(async ({ context, data }) => {
    if (data.lot_id) await ownsLot(context, data.lot_id);
    const { error } = await context.supabase.from("cattle_costs").insert({ ...data, description: data.description || null, user_id: context.userId });
    if (error) throw dbError(error);
    return { ok: true };
  });

const costRow = costInput.extend({ description: z.string().trim().max(300).nullable().optional() });

/** Vários custos de uma vez (foto do caderno): uma conferência de donos, um insert. */
export const addCattleCosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rows: z.array(costRow).min(1).max(100) }).parse(input))
  .handler(async ({ context, data }) => {
    const lotIds = [...new Set(data.rows.map((r) => r.lot_id).filter((x): x is string => x !== null))];
    if (lotIds.length > 0) {
      const { data: mine } = await context.supabase.from("cattle_lots").select("id").in("id", lotIds);
      if (((mine ?? []) as { id: string }[]).length !== lotIds.length) throw new Error(NOT_FOUND);
    }
    const rows = data.rows.map((r) => ({ ...r, description: r.description || null, notes: "Lido de foto do caderno.", user_id: context.userId }));
    const { error } = await context.supabase.from("cattle_costs").insert(rows);
    if (error) throw dbError(error);
    return { lines: rows.length };
  });

export const deleteCattleCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("cattle_costs").delete().eq("id", data.id);
    if (error) throw dbError(error);
    return { ok: true };
  });

// ---------------- Vendas ----------------
const saleInput = z.object({
  lot_id: z.string().uuid(),
  date: isoDate,
  head_count: z.number().int().min(1).max(100000),
  arrobas: z.number().gt(0).max(1e7).nullable().optional(),
  amount: z.number().gt(0).max(1e12),
});

async function refreshLotStatus(context: { supabase: any }, lotId: string, headCount: number) {
  const { data } = await context.supabase.from("cattle_sales").select("head_count").eq("lot_id", lotId);
  const sold = ((data ?? []) as { head_count: number }[]).reduce((a, s) => a + s.head_count, 0);
  const lost = await lostHeads(context, lotId);
  await context.supabase.from("cattle_lots").update({ status: sold + lost >= headCount ? "vendido" : "ativo" }).eq("id", lotId);
}

export const addCattleSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saleInput.parse(input))
  .handler(async ({ context, data }) => {
    const lot = await ownsLot(context, data.lot_id);
    const { data: prev } = await context.supabase.from("cattle_sales").select("head_count").eq("lot_id", data.lot_id);
    const already = ((prev ?? []) as { head_count: number }[]).reduce((a, s) => a + s.head_count, 0);
    const lost = await lostHeads(context, data.lot_id);
    if (already + lost + data.head_count > lot.head_count) {
      throw new Error(`Só restam ${Math.max(0, lot.head_count - already - lost)} cabeças neste lote.`);
    }
    const { error } = await context.supabase.from("cattle_sales").insert({ ...data, arrobas: data.arrobas ?? null, user_id: context.userId });
    if (error) throw dbError(error);
    await refreshLotStatus(context, data.lot_id, lot.head_count);
    return { ok: true };
  });

export const deleteCattleSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: sale } = await context.supabase.from("cattle_sales").select("lot_id").eq("id", data.id).maybeSingle();
    if (!sale) throw new Error(NOT_FOUND);
    const { error } = await context.supabase.from("cattle_sales").delete().eq("id", data.id);
    if (error) throw dbError(error);
    const lot = await ownsLot(context, (sale as { lot_id: string }).lot_id);
    await refreshLotStatus(context, (sale as { lot_id: string }).lot_id, lot.head_count);
    return { ok: true };
  });

// ---------------- Baixas ----------------
const lossInput = z.object({
  lot_id: z.string().uuid(),
  date: isoDate,
  head_count: z.number().int().min(1).max(100000),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const addCattleLoss = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => lossInput.parse(input))
  .handler(async ({ context, data }) => {
    const lot = await ownsLot(context, data.lot_id);
    const { data: prev } = await context.supabase.from("cattle_sales").select("head_count").eq("lot_id", data.lot_id);
    const sold = ((prev ?? []) as { head_count: number }[]).reduce((a, s) => a + s.head_count, 0);
    const lost = await lostHeads(context, data.lot_id);
    const left = Math.max(0, lot.head_count - sold - lost);
    if (data.head_count > left) throw new Error(`Só restam ${left} cabeças neste lote.`);
    const { error } = await context.supabase.from("cattle_losses").insert({ ...data, notes: data.notes || null, user_id: context.userId });
    if (error) {
      if (isMissing(error)) throw new Error("O registro de baixas ainda não está disponível nesta conta.");
      throw dbError(error);
    }
    await refreshLotStatus(context, data.lot_id, lot.head_count);
    return { ok: true };
  });

export const deleteCattleLoss = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: row } = await context.supabase.from("cattle_losses").select("lot_id").eq("id", data.id).maybeSingle();
    if (!row) throw new Error(NOT_FOUND);
    const lotId = (row as { lot_id: string }).lot_id;
    const lot = await ownsLot(context, lotId);
    const { error } = await context.supabase.from("cattle_losses").delete().eq("id", data.id);
    if (error) throw dbError(error);
    await refreshLotStatus(context, lotId, lot.head_count);
    return { ok: true };
  });
