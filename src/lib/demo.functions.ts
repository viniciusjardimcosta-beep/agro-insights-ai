import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const seedDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Property
    const { data: prop, error: propErr } = await supabase
      .from("properties")
      .insert({
        user_id: userId,
        name: "Fazenda Santa Maria",
        city: "Sorriso",
        state: "MT",
        total_area: 35,
      })
      .select()
      .single();
    if (propErr) throw new Error(propErr.message);

    const today = new Date().toISOString().slice(0, 10);
    const season = "2025/2026";

    // Fields
    const { data: fields, error: fErr } = await supabase
      .from("fields")
      .insert([
        {
          user_id: userId,
          property_id: prop.id,
          name: "Talhão 1",
          area: 20,
          crop: "soja",
          season,
          planting_date: today,
          estimated_yield: 65,
        },
        {
          user_id: userId,
          property_id: prop.id,
          name: "Talhão 2",
          area: 15,
          crop: "milho",
          season,
          planting_date: today,
          estimated_yield: 180,
        },
      ])
      .select();
    if (fErr) throw new Error(fErr.message);

    const [soja, milho] = fields!;

    // Costs
    const costs = [
      { field_id: soja.id, category: "Sementes", description: "Semente soja RR", amount: 18000 },
      { field_id: soja.id, category: "Fertilizantes", description: "MAP + KCl", amount: 32000 },
      { field_id: soja.id, category: "Defensivos", description: "Herbicida + fungicida", amount: 14000 },
      { field_id: soja.id, category: "Diesel", description: "Operações", amount: 8000 },
      { field_id: soja.id, category: "Arrendamento", description: "Sacas/ha", amount: 22000 },
      { field_id: soja.id, category: "Mão de obra", description: "Equipe safra", amount: 9000 },
      { field_id: milho.id, category: "Sementes", description: "Híbrido milho", amount: 11000 },
      { field_id: milho.id, category: "Fertilizantes", description: "Ureia + NPK", amount: 21000 },
      { field_id: milho.id, category: "Defensivos", description: "Inseticida", amount: 9000 },
      { field_id: milho.id, category: "Diesel", description: "Plantio + colheita", amount: 6500 },
      { field_id: milho.id, category: "Máquinas", description: "Manutenção", amount: 4000 },
      { field_id: milho.id, category: "Mão de obra", description: "Equipe safra", amount: 6500 },
    ].map((c) => ({ ...c, user_id: userId, date: today }));
    const { error: cErr } = await supabase.from("costs").insert(costs);
    if (cErr) throw new Error(cErr.message);

    // Prices
    const { error: pErr } = await supabase.from("prices").insert([
      { user_id: userId, crop: "soja", price_per_bag: 125, date: today },
      { user_id: userId, crop: "milho", price_per_bag: 60, date: today },
    ]);
    if (pErr) throw new Error(pErr.message);

    return { ok: true };
  });