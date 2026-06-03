import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          const msg = (error as Error)?.message ?? "";
          if (msg.includes("Unauthorized")) return false;
          return failureCount < 1;
        },
        staleTime: 30_000,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        const msg = (error as Error)?.message ?? "";
        // Swallow auth errors silently — they happen during sign-out / session expiry
        if (msg.includes("Unauthorized")) {
          console.warn("[query] auth error suppressed:", msg);
          return;
        }
        console.error("[query] error:", error);
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
