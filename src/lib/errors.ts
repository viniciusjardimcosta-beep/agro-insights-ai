// Erros estruturados compartilhados (cliente + servidor).
//
// Separa SEMPRE:
// - `userMessage`: texto seguro exibido ao usuário (sem detalhes técnicos).
// - `code` / `status` / `correlationId` / `timestamp`: informação técnica para logs.
// Stack traces nunca são enviados ao frontend.

export const ERROR_CODES = {
  AI_TIMEOUT: "AI_TIMEOUT",
  AI_FAILED: "AI_FAILED",
  AI_RATE_LIMITED: "AI_RATE_LIMITED",
  AI_MESSAGE_TOO_LONG: "AI_MESSAGE_TOO_LONG",
  DIAGNOSTIC_FAILED: "DIAGNOSTIC_FAILED",
  DIAGNOSTIC_RATE_LIMITED: "DIAGNOSTIC_RATE_LIMITED",
  REPORT_FAILED: "REPORT_FAILED",
  TRIAL_EXPIRED: "TRIAL_EXPIRED",
  SUBSCRIPTION_REQUIRED: "SUBSCRIPTION_REQUIRED",
  SUBSCRIPTION_INACTIVE: "SUBSCRIPTION_INACTIVE",
  // Cobrança
  BILLING_NOT_CONFIGURED: "BILLING_NOT_CONFIGURED",
  INVALID_PLAN: "INVALID_PLAN",
  CHECKOUT_FAILED: "CHECKOUT_FAILED",
  WEBHOOK_INVALID: "WEBHOOK_INVALID",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  SUBSCRIPTION_PAST_DUE: "SUBSCRIPTION_PAST_DUE",
  FOUNDER_PLAN_NOT_ELIGIBLE: "FOUNDER_PLAN_NOT_ELIGIBLE",
  BILLING_CANCEL_UNCONFIRMED: "BILLING_CANCEL_UNCONFIRMED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION: "VALIDATION",
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type StructuredError = {
  code: ErrorCode;
  status: number;
  correlationId: string | null;
  timestamp: string;
  userMessage: string;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly correlationId: string | null;
  readonly userMessage: string;
  readonly timestamp: string;

  constructor(opts: {
    code: ErrorCode;
    userMessage: string;
    status?: number;
    correlationId?: string | null;
    /** Detalhe técnico — fica apenas em logs, nunca vai ao usuário. */
    cause?: unknown;
  }) {
    super(opts.userMessage);
    this.name = "AppError";
    this.code = opts.code;
    this.status = opts.status ?? 500;
    this.correlationId = opts.correlationId ?? null;
    this.userMessage = opts.userMessage;
    this.timestamp = new Date().toISOString();
    if (opts.cause !== undefined) this.cause = opts.cause;
  }

  /** Forma segura para logs/monitoramento: sem stack, sem payload. */
  toStructured(): StructuredError {
    return {
      code: this.code,
      status: this.status,
      correlationId: this.correlationId,
      timestamp: this.timestamp,
      userMessage: this.userMessage,
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

const GENERIC_MESSAGE = "Não foi possível concluir a operação. Tente novamente.";

/** Mensagem exibível: nunca vaza stack trace nem detalhes de infraestrutura. */
export function toUserMessage(err: unknown): string {
  if (isAppError(err)) return err.userMessage;
  const raw = err instanceof Error ? err.message : "";
  // Mensagens de negócio já são curtas e em PT-BR; qualquer coisa técnica vira genérica.
  const technical = /\b(at\s+\w+\s*\(|stack|TypeError|ReferenceError|fetch failed|ECONN|500|undefined is not)\b/i;
  if (!raw || raw.length > 180 || technical.test(raw)) return GENERIC_MESSAGE;
  return raw;
}

export function errorCodeOf(err: unknown): ErrorCode {
  return isAppError(err) ? err.code : ERROR_CODES.UNKNOWN;
}
