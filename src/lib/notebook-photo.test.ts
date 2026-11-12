import { describe, expect, it } from "vitest";
import { isAlreadyLogged, monthlyAllowed, parseNotebookResponse, resolveNotebookDate, sniffImage } from "./notebook-photo";

const today = new Date(2026, 10, 11); // 11/11/2026

describe("resolveNotebookDate", () => {
  it("dia/mês sem ano usa o ano atual", () => expect(resolveNotebookDate("08/11", today)).toBe("2026-11-08"));
  it("data no futuro vira ano passado", () => expect(resolveNotebookDate("20/12", today)).toBe("2025-12-20"));
  it("data completa", () => expect(resolveNotebookDate("03/11/2026", today)).toBe("2026-11-03"));
  it("vazio, null e lixo", () => {
    expect(resolveNotebookDate(null, today)).toBeNull();
    expect(resolveNotebookDate("null", today)).toBeNull();
    expect(resolveNotebookDate("31/02", today)).toBeNull();
  });
});

describe("parseNotebookResponse", () => {
  it("lê o caderno de exemplo", () => {
    const text = '```json\n{"items":[{"description":"Semente","amount":20000,"date":"08/11","category":"Sementes"},{"description":"Diesel trator","amount":"2.500","date":null,"category":"Diesel"},{"description":"Fertilizante","amount":25000,"date":"03/11","category":"Fertilizantes"},{"description":"Manutenção colheitadeira","amount":1750,"date":null,"category":"Outros"}]}\n```';
    const r = parseNotebookResponse(text, today);
    expect(r.items).toHaveLength(4);
    expect(r.items[0]).toMatchObject({ amount: 20000, date: "2026-11-08", dateFound: true, category: "Sementes" });
    expect(r.items[1]).toMatchObject({ amount: 2500, date: "2026-11-11", dateFound: false, category: "Diesel" });
    expect(r.items[3].category).toBe("Máquinas");
  });
  it("descarta item sem valor legível e conta", () => {
    const r = parseNotebookResponse('{"items":[{"description":"x","amount":null},{"description":"y","amount":0},{"description":"ok","amount":10}]}', today);
    expect(r.items).toHaveLength(1);
    expect(r.ignored).toBe(2);
  });
  it("resposta vazia ou sem lista", () => {
    expect(parseNotebookResponse('{"items":[]}', today).items).toEqual([]);
    expect(parseNotebookResponse('{"foo":1}', today).items).toEqual([]);
  });
  it("sem JSON dá erro", () => expect(() => parseNotebookResponse("não consegui", today)).toThrow());
  it("limita a quantidade de itens", () => {
    const many = JSON.stringify({ items: Array.from({ length: 60 }, () => ({ description: "a", amount: 1 })) });
    const r = parseNotebookResponse(many, today);
    expect(r.items).toHaveLength(40);
    expect(r.ignored).toBe(20);
  });
});

describe("limite e imagem", () => {
  it("limite mensal", () => {
    expect(monthlyAllowed(99)).toBe(true);
    expect(monthlyAllowed(100)).toBe(false);
  });
  it("reconhece o formato pelo começo do arquivo", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array(20))).toBeNull();
  });
});

describe("isAlreadyLogged", () => {
  const existing = [
    { field_id: "a", date: "2026-11-08", category: "Sementes", amount: 20000 },
    { field_id: "a", date: "2026-11-11", category: "Diesel", amount: "1250.5" as unknown as number },
    { field_id: "b", date: "2026-11-11", category: "Diesel", amount: 1250 },
  ];
  it("igual no mesmo talhão", () => expect(isAlreadyLogged({ date: "2026-11-08", category: "Sementes", amount: 20000 }, "a", existing)).toBe(true));
  it("outro talhão não conta", () => expect(isAlreadyLogged({ date: "2026-11-08", category: "Sementes", amount: 20000 }, "b", existing)).toBe(false));
  it("valor ou data diferente não conta", () => {
    expect(isAlreadyLogged({ date: "2026-11-08", category: "Sementes", amount: 19999 }, "a", existing)).toBe(false);
    expect(isAlreadyLogged({ date: "2026-11-09", category: "Sementes", amount: 20000 }, "a", existing)).toBe(false);
  });
  it("todos pela área compara a soma do dia", () => {
    expect(isAlreadyLogged({ date: "2026-11-11", category: "Diesel", amount: 2500.5 }, "all", existing)).toBe(true);
    expect(isAlreadyLogged({ date: "2026-11-11", category: "Diesel", amount: 1250 }, "all", existing)).toBe(false);
  });
  it("sem talhão escolhido não avisa", () => expect(isAlreadyLogged({ date: "2026-11-08", category: "Sementes", amount: 20000 }, "", existing)).toBe(false));
});

describe("categoria pela descrição", () => {
  it("roçada (escrita certa) vira Cercas e infraestrutura mesmo se a IA disser Serviços contratados", () => {
    const r = parseNotebookResponse('{"items":[{"description":"Roçada","amount":1200,"category":"Serviços contratados"}]}', new Date("2026-11-12"));
    expect(r.items[0].category).toBe("Cercas e infraestrutura");
  });
});

describe("ração", () => {
  it("ração vai para Alimentação mesmo se a IA disser Outros", () => {
    const r = parseNotebookResponse('{"items":[{"description":"Ração","amount":1200,"category":"Outros"}]}', new Date("2026-11-12"));
    expect(r.items[0].category).toBe("Alimentação");
  });
});
