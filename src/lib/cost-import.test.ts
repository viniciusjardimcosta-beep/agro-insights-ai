import { describe, expect, it } from "vitest";
import {
  buildDrafts,
  decodeCsvBytes,
  detectRoles,
  hasHeaderRow,
  normalizeCategory,
  parseCsv,
  parseDateBR,
  parseMoney,
} from "@/lib/cost-import";

describe("parseMoney", () => {
  it("lê formatos brasileiros e simples", () => {
    expect(parseMoney("R$ 1.234,56")).toBe(1234.56);
    expect(parseMoney("1234,5")).toBe(1234.5);
    expect(parseMoney("1.234")).toBe(1234); // milhar
    expect(parseMoney("1.234.567")).toBe(1234567);
    expect(parseMoney("1234.56")).toBe(1234.56);
    expect(parseMoney("0.5")).toBe(0.5);
    expect(parseMoney("12.5")).toBe(12.5);
    expect(parseMoney("32000")).toBe(32000);
    expect(parseMoney("1,234.56")).toBe(1234.56);
    expect(parseMoney(150)).toBe(150);
  });
  it("recusa vazio, texto, negativo e formatos quebrados", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("-50")).toBeNull();
    expect(parseMoney("(50,00)")).toBeNull();
    expect(parseMoney("1,2,3")).toBeNull();
    expect(parseMoney(NaN)).toBeNull();
    expect(parseMoney(-1)).toBeNull();
  });
});

describe("parseDateBR", () => {
  it("lê dia/mês/ano e ISO", () => {
    expect(parseDateBR("03/06/2026")).toBe("2026-06-03");
    expect(parseDateBR("3/6/26")).toBe("2026-06-03");
    expect(parseDateBR("03-06-2026")).toBe("2026-06-03");
    expect(parseDateBR("03.06.2026")).toBe("2026-06-03");
    expect(parseDateBR("2026-06-03")).toBe("2026-06-03");
    expect(parseDateBR("2026-06-03T10:00:00Z")).toBe("2026-06-03");
  });
  it("trata ambiguidade como dia primeiro", () => {
    expect(parseDateBR("05/04/2026")).toBe("2026-04-05");
  });
  it("recusa datas impossíveis", () => {
    expect(parseDateBR("31/02/2026")).toBeNull();
    expect(parseDateBR("00/01/2026")).toBeNull();
    expect(parseDateBR("13/13/2026")).toBeNull();
    expect(parseDateBR("ontem")).toBeNull();
    expect(parseDateBR("")).toBeNull();
  });
  it("número serial do Excel só com allowSerial", () => {
    expect(parseDateBR("45000")).toBeNull(); // 5 dígitos fora da coluna de data = dinheiro
    expect(parseDateBR("45000", true)).toBe("2023-03-15");
    expect(parseDateBR("46176", true)).toBe("2026-06-03");
  });
});

describe("normalizeCategory", () => {
  it("reconhece o nome exato e sinônimos comuns", () => {
    expect(normalizeCategory("Diesel")).toEqual({ category: "Diesel", confident: true });
    expect(normalizeCategory("mão de obra").category).toBe("Mão de obra");
    expect(normalizeCategory("MAO DE OBRA").category).toBe("Mão de obra");
    expect(normalizeCategory("Adubo NPK 04-14-08").category).toBe("Fertilizantes");
    expect(normalizeCategory("Herbicida glifosato").category).toBe("Defensivos");
    expect(normalizeCategory("Semente soja RR").category).toBe("Sementes");
    expect(normalizeCategory("Combustível").category).toBe("Diesel");
    expect(normalizeCategory("Arrendamento sacas").category).toBe("Arrendamento");
    expect(normalizeCategory("Manutenção trator").category).toBe("Máquinas");
  });
  it("cai em Outros, sem confiança, quando não reconhece", () => {
    expect(normalizeCategory("Contador")).toEqual({ category: "Outros", confident: false });
    expect(normalizeCategory("")).toEqual({ category: "Outros", confident: false });
  });
});

describe("parseCsv / decodeCsvBytes", () => {
  it("detecta ponto e vírgula e lê aspas", () => {
    const rows = parseCsv('Data;Valor;Descrição\n03/06/2026;"1.234,56";"Diesel; posto ""X"""\n');
    expect(rows).toEqual([
      ["Data", "Valor", "Descrição"],
      ["03/06/2026", "1.234,56", 'Diesel; posto "X"'],
    ]);
  });
  it("detecta vírgula e tab, ignora linhas vazias e BOM", () => {
    expect(parseCsv("﻿a,b\n1,2\n\n3,4\r\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("aceita quebra de linha dentro de aspas", () => {
    expect(parseCsv('a;b\n"x\ny";2')).toEqual([["a", "b"], ["x\ny", "2"]]);
  });
  it("decodifica UTF-8 e Windows-1252", () => {
    expect(decodeCsvBytes(new TextEncoder().encode("Mão de obra"))).toBe("Mão de obra");
    // "Mão" em Windows-1252: 4D E3 6F
    expect(decodeCsvBytes(new Uint8Array([0x4d, 0xe3, 0x6f]))).toBe("Mão");
  });
});

describe("detectRoles / hasHeaderRow", () => {
  it("usa o título das colunas", () => {
    const h = ["Data", "Talhão", "Categoria", "Descrição", "Valor (R$)", "Qtd"];
    expect(detectRoles(h, [])).toEqual(["date", "field", "category", "description", "amount", "ignore"]);
  });
  it("ignora preço unitário e quantidade", () => {
    expect(detectRoles(["Data", "Valor unitário", "Quantidade", "Total"], [])).toEqual(["date", "ignore", "ignore", "amount"]);
  });
  it("usa o conteúdo quando o título não ajuda", () => {
    const body = [["03/06/2026", "diesel", "8000"], ["04/06/2026", "adubo", "12000,50"]];
    expect(detectRoles(["A", "B", "C"], body)).toEqual(["date", "ignore", "amount"]);
  });
  it("não confunde valor de 5 dígitos com data", () => {
    const body = [["32000"], ["45000"], ["38000"]];
    expect(detectRoles(["x"], body)).toEqual(["amount"]);
  });
  it("cada papel é usado uma vez só", () => {
    expect(detectRoles(["Data", "Data de pagamento"], [])).toEqual(["date", "ignore"]);
  });
  it("reconhece cabeçalho", () => {
    expect(hasHeaderRow([["Data", "Valor"], ["03/06/2026", "10"]])).toBe(true);
    expect(hasHeaderRow([["03/06/2026", "10"], ["04/06/2026", "20"]])).toBe(false);
  });
});

const fields = [
  { id: "f1", name: "Talhão 1" },
  { id: "f2", name: "Talhão 2" },
];
const roles = ["date", "field", "category", "description", "amount"] as const;

describe("buildDrafts", () => {
  const rows = [
    ["Data", "Talhão", "Categoria", "Descrição", "Valor"],
    ["03/06/2026", "talhao 1", "Diesel", "Operações", "8.000,00"],
    ["03/06/2026", "Talhão 2", "Sementes", "Híbrido milho", "7000"],
    ["", "", "", "", ""],
    ["31/02/2026", "Talhão 1", "Diesel", "x", "100"],
    ["04/06/2026", "Talhão 9", "Contador", "honorários", "300"],
    ["05/06/2026", "", "Adubo", "", "0"],
    ["TOTAL", "", "", "", "15.400,00"],
  ];
  const r = buildDrafts(rows, { roles: [...roles], fields, defaultTarget: "all", existing: [], skipFirst: true });

  it("importa linhas boas e pula linha vazia e total", () => {
    expect(r.drafts.map((d) => d.row)).toEqual([2, 3, 5, 6, 7]);
    expect(r.skipped).toEqual([{ row: 8, reason: "linha de total" }]);
  });
  it("linha boa: ok, talhão achado pelo nome sem acento", () => {
    expect(r.drafts[0]).toMatchObject({ status: "ok", target: "f1", amount: 8000, date: "2026-06-03", category: "Diesel", description: "Operações" });
    expect(r.drafts[1]).toMatchObject({ status: "ok", target: "f2", amount: 7000, category: "Sementes" });
  });
  it("data inválida e valor zero são erros", () => {
    expect(r.drafts[2]).toMatchObject({ status: "error", date: null });
    expect(r.drafts[2].issues).toContain("Data inválida");
    expect(r.drafts[4]).toMatchObject({ status: "error", amount: 0 });
    expect(r.drafts[4].issues).toContain("Valor zero");
  });
  it("talhão desconhecido e categoria desconhecida pedem revisão e usam o padrão", () => {
    expect(r.drafts[3]).toMatchObject({ status: "review", target: "all", category: "Outros" });
    expect(r.drafts[3].issues).toEqual(expect.arrayContaining(['Talhão "Talhão 9" não encontrado', "Categoria não reconhecida"]));
  });
  it("sem talhão e sem padrão é erro", () => {
    const x = buildDrafts([["03/06/2026", "", "Diesel", "", "10"]], { roles: [...roles], fields, defaultTarget: null, existing: [], skipFirst: false });
    expect(x.drafts[0]).toMatchObject({ status: "error", target: null });
  });
  it("marca duplicado contra custos existentes e pede revisão", () => {
    const x = buildDrafts([["03/06/2026", "Talhão 1", "Diesel", "", "8000"]], {
      roles: [...roles], fields, defaultTarget: null, skipFirst: false,
      existing: [{ field_id: "f1", date: "2026-06-03", category: "Diesel", amount: 8000 }],
    });
    expect(x.drafts[0]).toMatchObject({ status: "review", duplicate: true });
  });
  it("categoria vem da descrição quando não há coluna de categoria", () => {
    const x = buildDrafts([["03/06/2026", "Compra de adubo NPK", "5000"]], {
      roles: ["date", "description", "amount"], fields, defaultTarget: "f1", existing: [], skipFirst: false,
    });
    expect(x.drafts[0]).toMatchObject({ status: "ok", category: "Fertilizantes" });
  });
  it("sem coluna de data ou de valor, tudo é erro", () => {
    const x = buildDrafts([["a", "b"]], { roles: ["category", "description"], fields, defaultTarget: "f1", existing: [], skipFirst: false });
    expect(x.drafts[0].status).toBe("error");
    expect(x.drafts[0].issues).toEqual(expect.arrayContaining(["Sem coluna de data", "Sem coluna de valor"]));
  });
  it("serial do Excel na coluna de data", () => {
    const x = buildDrafts([["46176", "Talhão 1", "Diesel", "", "10"]], { roles: [...roles], fields, defaultTarget: null, existing: [], skipFirst: false });
    expect(x.drafts[0]).toMatchObject({ date: "2026-06-03", status: "ok" });
  });
  it("limita a 1000 linhas", () => {
    const many = Array.from({ length: 1005 }, () => ["03/06/2026", "Talhão 1", "Diesel", "", "10"]);
    const x = buildDrafts(many, { roles: [...roles], fields, defaultTarget: null, existing: [], skipFirst: false });
    expect(x.drafts).toHaveLength(1000);
    expect(x.truncated).toBe(true);
  });
});
