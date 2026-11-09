import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAuditEvent, type AuditEventType } from "@/lib/audit.server";
import { dbError, fetchAll, isIsoDate } from "@/lib/db-utils";
import { splitByArea } from "@/lib/cost-split";

const isoDate = z.string().refine(isIsoDate, "Data inválida (use AAAA-MM-DD)");

const NOT_FOUND = "Recurso não encontrado";

// Auditoria: apenas ação + entidade. Nenhum valor financeiro, descrição ou nome.
type Ctx = { supabase: any; userId: string };
async function audit(
  context: Ctx,
  eventType: AuditEventType,
  opts: { entityType: string; entityId?: string | null; propertyId?: string | null; durationMs?: number },
) {
  await recordAuditEvent(context.supabase, {
    eventType,
    entityType: opts.entityType,
    entityId: opts.entityId ?? null,
    propertyId: opts.propertyId ?? null,
    metadata: opts.durationMs !== undefined ? { duration_ms: opts.durationMs } : {},
  });
}

// ---------------- Properties ----------------
export const listProperties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw dbError(error);
    return data ?? [];
  });

const propertyInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(2).optional().nullable(),
  total_area: z.number().min(0),
});

export const upsertProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => propertyInput.parse(input))
  .handler(async ({ context, data }) => {
    const row = { ...data, user_id: context.userId };
    if (data.id) {
      const { data: existing } = await context.supabase
        .from("properties").select("id").eq("id", data.id).maybeSingle();
      if (!existing) throw new Error(NOT_FOUND);
    }
    const { error } = await context.supabase.from("properties").upsert(row);
    if (error) throw dbError(error);
    await audit(context, data.id ? "property_updated" : "property_created", {
      entityType: "property",
      entityId: data.id ?? null,
      propertyId: data.id ?? null,
    });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true };
  });

export const deleteProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("properties").delete().eq("id", data.id);
    if (error) throw dbError(error);
    await audit(context, "property_deleted", { entityType: "property", entityId: data.id });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true };
  });

// ---------------- Fields ----------------
export const listFields = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("fields")
      .select("*, properties(name)")
      .order("created_at", { ascending: false });
    if (error) throw dbError(error);
    return data ?? [];
  });

const fieldInput = z.object({
  id: z.string().uuid().optional(),
  property_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  area: z.number().min(0),
  crop: z.string().min(1).max(40),
  season: z.string().max(40).optional().nullable(),
  planting_date: isoDate.optional().nullable(),
  estimated_yield: z.number().min(0).optional().nullable(),
  real_yield: z.number().min(0).optional().nullable(),
});

export const upsertField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fieldInput.parse(input))
  .handler(async ({ context, data }) => {
    const { data: prop } = await context.supabase
      .from("properties").select("id").eq("id", data.property_id).maybeSingle();
    if (!prop) throw new Error(NOT_FOUND);
    if (data.id) {
      const { data: existing } = await context.supabase
        .from("fields").select("id").eq("id", data.id).maybeSingle();
      if (!existing) throw new Error(NOT_FOUND);
    }
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase.from("fields").upsert(row);
    if (error) throw dbError(error);
    await audit(context, data.id ? "field_updated" : "field_created", {
      entityType: "field",
      entityId: data.id ?? null,
      propertyId: data.property_id,
    });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true };
  });

export const deleteField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("fields").delete().eq("id", data.id);
    if (error) throw dbError(error);
    await audit(context, "field_deleted", { entityType: "field", entityId: data.id });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true };
  });

// ---------------- Costs ----------------
export const listCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("costs")
      .select("*, fields(name, crop)")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }); // mesmo dia: o lançamento mais novo primeiro
    if (error) throw dbError(error);
    return data ?? [];
  });

const costInput = z.object({
  id: z.string().uuid().optional(),
  field_id: z.string().uuid(),
  category: z.string().min(1).max(60),
  description: z.string().max(300).optional().nullable(),
  amount: z.number().min(0),
  date: isoDate,
  notes: z.string().max(500).optional().nullable(),
});

export const upsertCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => costInput.parse(input))
  .handler(async ({ context, data }) => {
    const { data: field } = await context.supabase
      .from("fields").select("id").eq("id", data.field_id).maybeSingle();
    if (!field) throw new Error(NOT_FOUND);
    if (data.id) {
      const { data: existing } = await context.supabase
        .from("costs").select("id").eq("id", data.id).maybeSingle();
      if (!existing) throw new Error(NOT_FOUND);
    }
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase.from("costs").upsert(row);
    if (error) throw dbError(error);
    await audit(context, data.id ? "cost_updated" : "cost_created", {
      entityType: "cost",
      entityId: data.id ?? null,
      propertyId: null,
    });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true };
  });

const costSplitInput = z.object({
  field_ids: z.array(z.string().uuid()).min(1).max(200),
  category: z.string().min(1).max(60),
  description: z.string().max(300).optional().nullable(),
  amount: z.number().gt(0).max(1e12),
  date: isoDate,
  notes: z.string().max(400).optional().nullable(),
});

// Lança um custo da fazenda dividido entre talhões, proporcional à área.
// A área vem do banco (nunca do navegador) e tudo entra numa única gravação.
export const createCostSplit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => costSplitInput.parse(input))
  .handler(async ({ context, data }) => {
    const ids = [...new Set(data.field_ids)];
    const { data: fields, error: fErr } = await context.supabase
      .from("fields").select("id, area").in("id", ids);
    if (fErr) throw dbError(fErr);
    if (!fields || fields.length !== ids.length) throw new Error(NOT_FOUND);

    const shares = splitByArea(
      data.amount,
      fields.map((f: { id: string; area: number | string }) => ({ id: f.id, area: Number(f.area) })),
    );
    if (shares.length === 0) {
      throw new Error("Os talhões escolhidos não têm área cadastrada. Informe a área para ratear.");
    }

    const total = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(data.amount);
    const note =
      `Rateio por área: ${total} entre ${shares.length} talhões.` + (data.notes ? ` ${data.notes}` : "");
    const rows = shares.map((s) => ({
      user_id: context.userId,
      field_id: s.field_id,
      category: data.category,
      description: data.description ?? null,
      amount: s.amount,
      date: data.date,
      notes: note,
    }));
    const { error } = await context.supabase.from("costs").insert(rows);
    if (error) throw dbError(error);
    await audit(context, "cost_created", { entityType: "cost", entityId: null, propertyId: null });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true, count: rows.length };
  });

const importRow = z.object({
  target: z.union([z.literal("all"), z.string().uuid()]),
  category: z.string().min(1).max(60),
  description: z.string().max(300).optional().nullable(),
  amount: z.number().gt(0).max(1e12),
  date: isoDate,
});

// Importa várias linhas de custo já revisadas pelo usuário (planilha/CSV).
// Cada linha vai para um talhão ou é dividida por área ("all"). Tudo numa única gravação.
export const importCosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rows: z.array(importRow).min(1).max(1000) }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: fields, error: fErr } = await context.supabase.from("fields").select("id, area");
    if (fErr) throw dbError(fErr);
    const mine = new Map((fields ?? []).map((f: { id: string; area: number | string }) => [f.id, Number(f.area)]));
    const all = [...mine.entries()].map(([id, area]) => ({ id, area }));

    const out: {
      user_id: string; field_id: string; category: string; description: string | null;
      amount: number; date: string; notes: string | null;
    }[] = [];
    for (const r of data.rows) {
      if (r.target === "all") {
        const shares = splitByArea(r.amount, all);
        if (shares.length === 0) throw new Error("Cadastre a área dos talhões para ratear custos da fazenda.");
        const total = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(r.amount);
        for (const s of shares) {
          out.push({
            user_id: context.userId, field_id: s.field_id, category: r.category,
            description: r.description ?? null, amount: s.amount, date: r.date,
            notes: `Rateio por área: ${total} entre ${shares.length} talhões. Importado de planilha.`,
          });
        }
      } else {
        if (!mine.has(r.target)) throw new Error(NOT_FOUND);
        out.push({
          user_id: context.userId, field_id: r.target, category: r.category,
          description: r.description ?? null, amount: r.amount, date: r.date,
          notes: "Importado de planilha.",
        });
      }
    }
    if (out.length > 5000) throw new Error("Importação grande demais. Divida em partes menores.");
    const { error } = await context.supabase.from("costs").insert(out);
    if (error) throw dbError(error);
    await audit(context, "cost_created", { entityType: "cost", entityId: null, propertyId: null });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true, count: out.length, lines: data.rows.length };
  });

export const deleteCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("costs").delete().eq("id", data.id);
    if (error) throw dbError(error);
    await audit(context, "cost_deleted", { entityType: "cost", entityId: data.id });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true };
  });

// ---------------- Prices ----------------
export const listPrices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("prices")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw dbError(error);
    return data ?? [];
  });

const priceInput = z.object({
  id: z.string().uuid().optional(),
  crop: z.string().min(1).max(40),
  price_per_bag: z.number().min(0),
  date: isoDate,
});

export const upsertPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => priceInput.parse(input))
  .handler(async ({ context, data }) => {
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase.from("prices").upsert(row);
    if (error) throw dbError(error);
    await audit(context, data.id ? "price_updated" : "price_created", {
      entityType: "price",
      entityId: data.id ?? null,
      propertyId: null,
    });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true };
  });

export const deletePrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("prices").delete().eq("id", data.id);
    if (error) throw dbError(error);
    await audit(context, "price_deleted", { entityType: "price", entityId: data.id });
    const { resyncAlerts } = await import("@/lib/alerts.server");
    await resyncAlerts(context.supabase, context.userId);
    return { ok: true };
  });

// ---------------- Dashboard snapshot ----------------
export const getFarmSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [properties, fields, costs, prices] = await Promise.all([
      fetchAll((f, t) => sb.from("properties").select("*").order("id").range(f, t)),
      fetchAll((f, t) => sb.from("fields").select("*").order("id").range(f, t)),
      fetchAll((f, t) => sb.from("costs").select("*").order("id").range(f, t)),
      fetchAll((f, t) => sb.from("prices").select("*").order("id").range(f, t)),
    ]);
    return { properties, fields, costs, prices };
  });
