import { describe, expect, it } from "vitest";
import { lastCategory, lastTarget, rememberLast } from "./last-used";

const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  key: () => null, length: 0,
} as Storage;

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("last-used", () => {
  it("lembra o último talhão e categoria", () => {
    rememberLast(ID1, "Diesel");
    expect(lastTarget([ID1, ID2])).toBe(ID1);
    expect(lastCategory(["Diesel", "Outros"])).toBe("Diesel");
  });
  it("ignora talhão que não existe mais", () => {
    rememberLast(ID1, "Diesel");
    expect(lastTarget([ID2])).toBeNull();
  });
  it("aceita 'todos' e descarta categoria desconhecida", () => {
    rememberLast("all", "Inventada");
    expect(lastTarget([ID2])).toBe("all");
    expect(lastCategory(["Diesel"])).toBeNull();
  });
  it("não grava valores estranhos como talhão", () => {
    rememberLast(ID2, "Diesel");
    rememberLast("crop:Soja", "Diesel");
    expect(lastTarget([ID2])).toBe(ID2);
  });
});
