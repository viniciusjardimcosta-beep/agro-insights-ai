import { describe, expect, it } from "vitest";
import { splitByArea } from "@/lib/cost-split";

const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount * 100, 0));

describe("splitByArea", () => {
  it("divide proporcionalmente à área", () => {
    const r = splitByArea(35000, [
      { id: "a", area: 20 },
      { id: "b", area: 15 },
    ]);
    expect(r).toEqual([
      { field_id: "a", amount: 20000 },
      { field_id: "b", amount: 15000 },
    ]);
  });

  it("a soma das partes é exatamente o total, mesmo com centavos quebrados", () => {
    const r = splitByArea(100, [
      { id: "a", area: 1 },
      { id: "b", area: 1 },
      { id: "c", area: 1 },
    ]);
    expect(sum(r)).toBe(10000);
    expect(r.map((x) => x.amount).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it("mantém a soma exata em casos com áreas irregulares", () => {
    const fields = [
      { id: "a", area: 12.37 },
      { id: "b", area: 7.91 },
      { id: "c", area: 3.3 },
      { id: "d", area: 41.002 },
    ];
    for (const total of [0.01, 0.07, 1, 999.99, 12345.67, 1_000_000.01]) {
      expect(sum(splitByArea(total, fields))).toBe(Math.round(total * 100));
    }
  });

  it("ignora talhões sem área", () => {
    const r = splitByArea(100, [
      { id: "a", area: 10 },
      { id: "b", area: 0 },
    ]);
    expect(r).toEqual([{ field_id: "a", amount: 100 }]);
  });

  it("retorna vazio sem área total, sem talhões ou com valor inválido", () => {
    expect(splitByArea(100, [])).toEqual([]);
    expect(splitByArea(100, [{ id: "a", area: 0 }])).toEqual([]);
    expect(splitByArea(0, [{ id: "a", area: 5 }])).toEqual([]);
    expect(splitByArea(-5, [{ id: "a", area: 5 }])).toEqual([]);
    expect(splitByArea(NaN, [{ id: "a", area: 5 }])).toEqual([]);
  });

  it("um talhão só recebe tudo", () => {
    expect(splitByArea(123.45, [{ id: "a", area: 8 }])).toEqual([{ field_id: "a", amount: 123.45 }]);
  });

  it("não cria parte de R$ 0,00 para talhão minúsculo", () => {
    const r = splitByArea(0.01, [
      { id: "a", area: 1000 },
      { id: "b", area: 0.001 },
    ]);
    expect(r).toEqual([{ field_id: "a", amount: 0.01 }]);
  });
});
