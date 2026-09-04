import { useQuery } from "@tanstack/react-query";
import { ensureMySubscription } from "@/lib/subscription.functions";
import {
  hasEntitlement,
  type Feature,
  type SubscriptionAccess,
} from "@/lib/entitlements";

/**
 * Estado da assinatura para UX.
 *
 * A autorização real é sempre server-side — este hook existe apenas para
 * apresentação. Todos os timestamps vêm do servidor (`serverNow`), nunca do
 * relógio do navegador.
 */
export function useSubscription() {
  const query = useQuery<SubscriptionAccess>({
    queryKey: ["subscription"],
    // Idempotente: cria o trial na primeira entrada, depois só lê.
    queryFn: () => ensureMySubscription(),
    staleTime: 60_000,
  });

  const access = query.data ?? null;
  return {
    access,
    isLoading: query.isLoading,
    can: (feature: Feature) => (access ? hasEntitlement(access, feature) : true),
  };
}
