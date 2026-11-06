// Traduz mensagens de erro do login/cadastro (vêm em inglês do serviço de autenticação)
// para português claro. Nunca devolve a mensagem original: só texto controlado por nós.

const RULES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/invalid login credentials/i, "E-mail ou senha incorretos."],
  [/email not confirmed/i, "Confirme seu e-mail antes de entrar. Procure a mensagem de confirmação na caixa de entrada."],
  [/user already registered|already been registered|already exists/i, "Este e-mail já está cadastrado. Tente entrar ou use “Esqueci minha senha”."],
  [/password should be at least (\d+)/i, (m) => `A senha deve ter pelo menos ${m[1]} caracteres.`],
  [/new password should be different/i, "A nova senha deve ser diferente da anterior."],
  [/weak|easy to guess|pwned|compromised/i, "Senha fraca ou muito comum. Escolha outra, com letras e números."],
  [/unable to validate email|invalid format|valid email|email address .* is invalid/i, "E-mail inválido. Confira se digitou corretamente."],
  [/rate limit|too many requests|only request this after|security purposes/i, "Muitas tentativas. Aguarde um minuto e tente de novo."],
  [/failed to fetch|network|fetch failed|load failed/i, "Sem conexão com o servidor. Verifique a internet e tente de novo."],
  [/signups? (are )?(not allowed|disabled)/i, "Novos cadastros estão temporariamente indisponíveis."],
  [/session.*(expired|missing)|jwt expired|auth session missing/i, "Sua sessão expirou. Abra o link do e-mail novamente ou entre outra vez."],
  [/same password|different from the old/i, "A nova senha deve ser diferente da anterior."],
];

export const GENERIC_AUTH_ERROR = "Não foi possível concluir. Tente novamente em instantes.";

export function translateAuthError(message: string | null | undefined): string {
  const text = (message ?? "").trim();
  if (!text) return GENERIC_AUTH_ERROR;
  for (const [re, out] of RULES) {
    const m = text.match(re);
    if (m) return typeof out === "function" ? out(m) : out;
  }
  return GENERIC_AUTH_ERROR;
}
