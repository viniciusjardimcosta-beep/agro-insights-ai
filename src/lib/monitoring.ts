// Camada abstrata de monitoramento de erros (cliente e servidor).
//
// NÃO há fornecedor externo acoplado. O comportamento padrão usa console +
// o coletor nativo da plataforma quando disponível. Para conectar um provedor
// (ex.: Sentry) no futuro, chame `setMonitoringProvider(...)` no bootstrap —
// nenhum outro arquivo do projeto precisa mudar. Ver docs/OBSERVABILITY.md.
//
// PRIVACIDADE: nunca envie dados financeiros, mensagens do chat, e-mail,
// tokens ou cookies para o monitoramento. Apenas códigos e metadados curtos.
import { isAppError, toUserMessage, errorCodeOf } from "@/lib/errors";
import { reportLovableError } from "@/lib/lovable-error-reporting";

export type MonitoringContext = {
  /** Código curto do erro (ex.: AI_TIMEOUT). */
  errorCode?: string;
  /** Rota ou nome da função onde ocorreu. */
  route?: string;
  correlationId?: string | null;
  durationMs?: number;
  httpStatus?: number;
  /** Origem lógica (ex.: "dashboard", "consultor"). */
  source?: string;
};

export type MonitoringUser = { id: string };

export type MonitoringProvider = {
  captureError: (error: unknown, context: MonitoringContext) => void;
  captureMessage: (message: string, context: MonitoringContext) => void;
  setUser: (user: MonitoringUser | null) => void;
};

let provider: MonitoringProvider | null = null;
let currentUserId: string | null = null;

export function setMonitoringProvider(next: MonitoringProvider | null) {
  provider = next;
  if (provider) provider.setUser(currentUserId ? { id: currentUserId } : null);
}

/** Contexto seguro: sem PII, sem payload, sem stack. */
function safeContext(context: MonitoringContext) {
  return {
    error_code: context.errorCode,
    route: context.route,
    correlation_id: context.correlationId ?? undefined,
    duration_ms: context.durationMs,
    http_status: context.httpStatus,
    source: context.source,
    user_id: currentUserId ?? undefined,
  };
}

export function captureError(error: unknown, context: MonitoringContext = {}) {
  const ctx: MonitoringContext = {
    ...context,
    errorCode: context.errorCode ?? errorCodeOf(error),
    correlationId:
      context.correlationId ?? (isAppError(error) ? error.correlationId : null),
  };
  // Log técnico local — nunca exibido ao usuário.
  console.error("[monitoring]", safeContext(ctx), toUserMessage(error));
  if (typeof window !== "undefined") {
    reportLovableError(error, safeContext(ctx));
  }
  provider?.captureError(error, ctx);
}

export function captureMessage(message: string, context: MonitoringContext = {}) {
  console.warn("[monitoring]", message, safeContext(context));
  provider?.captureMessage(message, context);
}

export function setMonitoringUser(user: MonitoringUser | null) {
  currentUserId = user?.id ?? null;
  provider?.setUser(user);
}

export function clearMonitoringUser() {
  setMonitoringUser(null);
}

export function getMonitoringUserId() {
  return currentUserId;
}

/** Instala handlers globais do browser (uma única vez). */
let installed = false;
export function installBrowserMonitoring() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    captureError(event.error ?? new Error("window_error"), {
      route: window.location.pathname,
      source: "window_error",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    captureError(event.reason ?? new Error("unhandled_rejection"), {
      route: window.location.pathname,
      source: "unhandled_rejection",
    });
  });
}
