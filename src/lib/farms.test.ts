import { describe, expect, it } from "vitest";
import { accountFlagsFor, cattleOfFarm, farmFlags, inFarm, resolveSelected } from "./farms";

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
