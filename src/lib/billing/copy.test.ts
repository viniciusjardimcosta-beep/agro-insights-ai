import { describe, expect, it } from "vitest";
import { cancelScheduledMessage } from "./copy";

describe("cancelScheduledMessage", () => {
  it("usa 'para' (nunca 'parágrafo') antes da data de encerramento", () => {
    expect(cancelScheduledMessage("02/12/2026")).toBe(
      "Cancelamento agendado para 02/12/2026. Você mantém o acesso até lá e nenhuma nova cobrança será feita.",
    );
  });

  it("omite a data quando ela é desconhecida", () => {
    expect(cancelScheduledMessage(null)).toBe(
      "Cancelamento agendado. Você mantém o acesso até lá e nenhuma nova cobrança será feita.",
    );
  });
});
