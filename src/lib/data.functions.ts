import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------- Properties ----------------
export const listProperties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
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
    const { error } = await context.supabase.from("properties").upsert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("properties").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const fieldInput = z.object({
  id: z.string().uuid().optional(),
  property_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  area: z.number().min(0),
  crop: z.string().min(1).max(40),
  season: z.string().max(40).optional().nullable(),
  planting_date: z.string().optional().nullable(),
  estimated_yield: z.number().min(0).optional().nullable(),
  real_yield: z.number().min(0).optional().nullable(),
});

export const upsertField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fieldInput.parse(input))
  .handler(async ({ context, data }) => {
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase.from("fields").upsert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("fields").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Costs ----------------
export const listCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("costs")
      .select("*, fields(name, crop)")
      .order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const costInput = z.object({
  id: z.string().uuid().optional(),
  field_id: z.string().uuid(),
  category: z.string().min(1).max(60),
  description: z.string().max(300).optional().nullable(),
  amount: z.number().min(0),
  date: z.string(),
  notes: z.string().max(500).optional().nullable(),
});

export const upsertCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => costInput.parse(input))
  .handler(async ({ context, data }) => {
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase.from("costs").upsert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("costs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Prices ----------------
export const listPrices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("prices")
      .select("*")
      .order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const priceInput = z.object({
  id: z.string().uuid().optional(),
  crop: z.string().min(1).max(40),
  price_per_bag: z.number().min(0),
  date: z.string(),
});

export const upsertPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => priceInput.parse(input))
  .handler(async ({ context, data }) => {
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase.from("prices").upsert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("prices").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Dashboard snapshot ----------------
export const getFarmSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [properties, fields, costs, prices] = await Promise.all([
      context.supabase.from("properties").select("*"),
      context.supabase.from("fields").select("*"),
      context.supabase.from("costs").select("*"),
      context.supabase.from("prices").select("*"),
    ]);
    if (properties.error) throw new Error(properties.error.message);
    if (fields.error) throw new Error(fields.error.message);
    if (costs.error) throw new Error(costs.error.message);
    if (prices.error) throw new Error(prices.error.message);
    return {
      properties: properties.data ?? [],
      fields: fields.data ?? [],
      costs: costs.data ?? [],
      prices: prices.data ?? [],
    };
  });