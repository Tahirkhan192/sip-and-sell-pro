import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Lists that were already loaded stay usable for a short while instead of
  // being re-read from the local database on every screen change. Saves still
  // refresh what they change, because each save invalidates its own keys.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Everything is read from the database on this computer, so keeping
        // lists in memory longer makes switching screens instant.
        staleTime: 5 * 60_000,
        gcTime: 60 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 0,
        // Never wait for the internet: the data is local.
        networkMode: "always",
      },
      mutations: {
        networkMode: "always",
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
