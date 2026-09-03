// Versionamento dos documentos legais.
// Ao publicar uma nova versão, incremente aqui: a arquitetura já grava a versão
// aceita por usuário (`profiles.terms_version` / `privacy_version`), o que
// permite, no futuro, exigir novo aceite comparando com estas constantes.
export const TERMS_VERSION = "1.0";
export const PRIVACY_VERSION = "1.0";

export const LEGAL_DISCLAIMER =
  "As análises do AgroIntel são ferramentas de apoio à decisão e não substituem orientação profissional agronômica, contábil, financeira ou jurídica.";

export const PRIVACY_CONTACT = "privacidade@agrointel.ai";

/** Verdadeiro quando o usuário ainda não aceitou a versão vigente. */
export function needsReacceptance(profile: {
  terms_version?: string | null;
  privacy_version?: string | null;
}): boolean {
  return profile.terms_version !== TERMS_VERSION || profile.privacy_version !== PRIVACY_VERSION;
}
