import { describe, expect, it } from "vitest";
import { axisBRL } from "./format-pt";

describe("axisBRL", () => {
  it("formata rótulos de eixo em pt-BR sem repetir", () => {
    expect(axisBRL(0)).toBe("R$ 0");
    expect(axisBRL(500)).toBe("R$ 500");
    expect(axisBRL(1000)).toBe("R$ 1 mil");
    expect(axisBRL(2500)).toBe("R$ 2,5 mil");
    expect(axisBRL(-3000)).toBe("−R$ 3 mil");
    expect(axisBRL(1_200_000)).toBe("R$ 1,2 mi");
  });
});
