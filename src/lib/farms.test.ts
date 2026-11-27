import { describe, expect, it } from "vitest";
import { accountFlagsFor, cattleOfFarm, farmFlags, inFarm, resolveSelected, snapshotOfFarm, areaOverruns, areaOverrunText } from "./farms";

const both = { lavoura: true, pecuaria: true };
const lav = { lavoura: true, pecuaria: false };

describe("farms", () => {
  it("fazenda sem atividade segue a conta", () => {
    expect(farmFlags(null, lav)).toEqual(lav);
    expect(farmFlags(undefined, both)).toEqual(both);
    expect(farmFlags("qualquer", lav)).toEqual(lav);
  });
  it("atividade da fazenda manda", () => {
    expect(farmFlags("plantio", both)).toEqual({ lavoura: true, pecuaria: false });
    expect(farmFlags("pecuaria", both)).toEqual({ lavoura: false, pecuaria: true });
    expect(farmFlags("ilp", lav)).toEqual(both);
  });
  it("conta ganha o que a nova fazenda precisa, sem perder o que já tinha", () => {
    expect(accountFlagsFor("pecuaria", lav)).toEqual(both);
    expect(accountFlagsFor("plantio", both)).toEqual(both);
  });
  it("seleção inexistente volta para todas", () => {
    expect(resolveSelected([{ id: "a" }], "todas")).toBeNull();
    expect(resolveSelected([{ id: "a" }], "b")).toBeNull();
    expect(resolveSelected([{ id: "a" }], "a")).toEqual({ id: "a" });
  });
  it("pecuária só da fazenda escolhida", () => {
    const d = {
      lots: [{ id: "1", property_id: "a" }, { id: "2", property_id: "b" }, { id: "3", property_id: null }],
      costs: [{ lot_id: "1" }, { lot_id: "2" }, { lot_id: null }],
      sales: [{ lot_id: "1" }, { lot_id: "2" }],
      losses: [{ lot_id: "2" }],
    };
    expect(cattleOfFarm(d, null)).toBe(d);
    const a = cattleOfFarm(d, "a");
    expect(a.lots.map((l) => l.id)).toEqual(["1"]);
    expect(a.costs).toEqual([{ lot_id: "1" }]);
    expect(a.sales).toEqual([{ lot_id: "1" }]);
    expect(a.losses).toEqual([]);
  });
  it("filtro por fazenda", () => {
    expect(inFarm("a", null)).toBe(true);
    expect(inFarm(null, null)).toBe(true);
    expect(inFarm("a", "a")).toBe(true);
    expect(inFarm("b", "a")).toBe(false);
    expect(inFarm(null, "a")).toBe(false);
  });
});

describe("snapshotOfFarm", () => {
  const snap = {
    properties: [{ id: "p1" }, { id: "p2" }],
    fields: [{ id: "f1", property_id: "p1" }, { id: "f2", property_id: "p2" }],
    costs: [{ field_id: "f1", amount: 1 }, { field_id: "f2", amount: 2 }],
    prices: [{ crop: "Soja" }],
  };
  it("sem fazenda escolhida devolve tudo", () => {
    expect(snapshotOfFarm(snap, null).fields.length).toBe(2);
  });
  it("com fazenda escolhida fica só ela, os talhões e os custos dela", () => {
    const r = snapshotOfFarm(snap, "p2");
    expect(r.properties.length).toBe(1);
    expect(r.fields.length).toBe(1);
    expect(r.costs.length).toBe(1);
    expect(r.costs[0].amount).toBe(2);
    expect(r.prices.length).toBe(1);
  });
});

describe("areaOverruns (Etapa 20)", () => {
  it("avisa quando os talhões passam da área da fazenda", () => {
    const props = [{ id: "a", name: "Boa Vista", total_area: 50 }, { id: "b", name: "Sítio", total_area: 100 }];
    const fields = [{ property_id: "a", area: 40 }, { property_id: "a", area: 20 }, { property_id: "b", area: 30 }];
    const r = areaOverruns(props, fields);
    expect(r.length).toBe(1);
    expect(r[0].sum).toBe(60);
    expect(areaOverrunText(r[0], false)).toBe("Os talhões somam 60 ha e a fazenda tem 50 ha. Confira a área da fazenda ou a dos talhões.");
  });
});
