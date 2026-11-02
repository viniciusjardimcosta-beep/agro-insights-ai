// Textos comerciais da assinatura (PT-BR). Puros e testáveis: a UI não monta
// frases de cobrança inline, para evitar erros de tradução/formatação.

/** Aviso exibido quando há cancelamento agendado para o fim do período. */
export function cancelScheduledMessage(endLabel: string | null): string {
  return `Cancelamento agendado${endLabel ? ` para ${endLabel}` : ""}. Você mantém o acesso até lá e nenhuma nova cobrança será feita.`;
}
