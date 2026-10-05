// Autorização administrativa — server-only.
//
// requireAdmin: 1) sessão já validada pelo requireSupabaseAuth; 2) usa
// context.userId (auth.uid()); 3) consulta user_roles com o client DO USUÁRIO
// (RLS: só enxerga o próprio papel); 4) rejeita quem não é admin.
// Nunca recebe user_id do navegador. Service role só depois disso.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { rolesIncludeAdmin } from "@/lib/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export async function isAdmin(supabase: AnySupabase, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role, user_id")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (error) return false;
  return rolesIncludeAdmin(data as { role: string; user_id: string }[] | null, userId);
}

export async function requireAdmin(supabase: AnySupabase, userId: string): Promise<void> {
  if (!userId || !(await isAdmin(supabase, userId))) {
    throw new AppError({ code: ERROR_CODES.FORBIDDEN, status: 403, userMessage: "Acesso restrito à administração." });
  }
}
