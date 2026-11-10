import { describe, expect, it } from "vitest";
import { parseSpokenCost, wordsToNumber } from "./voice-parse";

const fields = [{ id: "f1", name: "Talhão 1" }, { id: "f2", name: "Talhão 2" }, { id: "f3", name: "Sede" }];
const now = new Date(2026, 10, 9); // 09/11/2026

describe("wordsToNumber", () => {
  it("converte números por extenso", () => {
    expect(wordsToNumber(["quatrocentos", "e", "cinquenta"])).toBe(450);
    expect(wordsToNumber(["mil", "e", "quinhentos"])).toBe(1500);
    expect(wordsToNumber(["dois", "mil"])).toBe(2000);
    expect(wordsToNumber(["vinte", "e", "cinco"])).toBe(25);
    expect(wordsToNumber(["banana"])).toBeNull();
  });
});

describe("parseSpokenCost", () => {
  it("frase completa com dígitos", () => {
    const r = parseSpokenCost("diesel 450 reais talhão 1 ontem", fields, now);
    expect(r.amount).toBe(450);
    expect(r.category).toBe("Diesel");
    expect(r.target).toBe("f1");
    expect(r.date).toBe("2026-11-08");
    expect(r.issues).toEqual([]);
  });
  it("valor por extenso", () => {
    const r = parseSpokenCost("comprei adubo por mil e quinhentos reais hoje", fields, now);
    expect(r.amount).toBe(1500);
    expect(r.category).toBe("Fertilizantes");
    expect(r.date).toBe("2026-11-09");
  });
  it("valor com vírgula e milhar", () => {
    expect(parseSpokenCost("defensivo 1.234,50 reais", fields, now).amount).toBe(1234.5);
    expect(parseSpokenCost("defensivo 1,5 mil", fields, now).amount).toBe(1500);
    expect(parseSpokenCost("diesel 450,75", fields, now).amount).toBe(450.75);
  });
  it("datas: dia N, dd/mm e por extenso", () => {
    expect(parseSpokenCost("diesel 100 dia 5", fields, now).date).toBe("2026-11-05");
    expect(parseSpokenCost("diesel 100 dia 20", fields, now).date).toBe("2026-10-20"); // futuro vira mês anterior
    expect(parseSpokenCost("diesel 100 em 03/10", fields, now).date).toBe("2026-10-03");
    expect(parseSpokenCost("diesel 100 dia 2 de setembro", fields, now).date).toBe("2026-09-02");
    expect(parseSpokenCost("diesel 100 anteontem", fields, now).date).toBe("2026-11-07");
  });
  it("sem data usa hoje", () => {
    expect(parseSpokenCost("diesel 100", fields, now).date).toBe("2026-11-09");
  });
  it("todos os talhões e talhão pelo nome", () => {
    expect(parseSpokenCost("mão de obra 800 todos os talhões", fields, now).target).toBe("all");
    expect(parseSpokenCost("manutenção 300 sede", fields, now).target).toBe("f3");
  });
  it("não confunde o número do talhão com o valor", () => {
    const r = parseSpokenCost("diesel 450 talhão 2", fields, now);
    expect(r.amount).toBe(450);
    expect(r.target).toBe("f2");
    const x = parseSpokenCost("diesel 450 talhão 9", fields, now);
    expect(x.amount).toBe(450);
    expect(x.target).toBeNull();
    expect(x.issues.join(" ")).toContain("talhão");
  });
  it("avisa quando não entende valor ou categoria", () => {
    const r = parseSpokenCost("alguma coisa ontem", fields, now);
    expect(r.amount).toBeNull();
    expect(r.issues).toContain("Não entendi o valor");
    expect(r.issues).toContain("Categoria não reconhecida");
    expect(r.category).toBe("Outros");
  });
  it("guarda a frase como descrição, com acento", () => {
    expect(parseSpokenCost("óleo diesel 450", fields, now).description).toBe("Óleo diesel 450");
  });
  it("aceita erros comuns do reconhecimento de voz no talhão", () => {
    const r = parseSpokenCost("dois mil e manutenção talião dois", fields, now);
    expect(r.amount).toBe(2000);
    expect(r.category).toBe("Máquinas");
    expect(r.target).toBe("f2");
    expect(parseSpokenCost("diesel 450 tarhão um", fields, now).target).toBe("f1");
    expect(parseSpokenCost("diesel 450 talhão dois", fields, now).target).toBe("f2");
  });
  it("não confunde outras palavras com talhão", () => {
    const r = parseSpokenCost("tarifa 100 reais", fields, now);
    expect(r.amount).toBe(100);
    expect(r.target).toBeNull();
    expect(r.issues.join(" ")).not.toContain("talhão");
  });
});
