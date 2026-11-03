// Utilidades puras (sem segredos) para acesso ao banco nas funções de servidor.

export const DB_ERROR_MESSAGE = "Não foi possível concluir a operação. Tente novamente.";

/**
 * Erros do banco podem expor nomes de tabelas/colunas/constraints.
 * Registra o detalhe no log do servidor e devolve ao usuário uma mensagem genérica.
 */
export function dbError(error: { message?: string } | null | undefined): Error {
  console.error("[db]", error?.message ?? "unknown error");
  return new Error(DB_ERROR_MESSAGE);
}

export const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;

/**
 * O Supabase devolve no máximo 1000 linhas por consulta. Esta função busca
 * todas as páginas. A consulta DEVE ter ordenação estável (ex.: .order("id")),
 * senão a paginação pode repetir ou pular linhas.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PageResult<T>,
  maxRows = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw dbError(error);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Data no formato AAAA-MM-DD e existente no calendário (rejeita 2025-02-31). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
