import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useBusinessConfigLoader } from "@/lib/use-settings";
import { getReadinessProgress, isLocalReady, subscribeReadiness } from "@/pwa/readiness";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthLayout,
});

function useLocalReady(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeReadiness(cb),
    () => isLocalReady(),
    () => false,
  );
}
function useReadinessProgress(): string {
  return useSyncExternalStore(
    (cb) => subscribeReadiness(cb),
    () => getReadinessProgress(),
    () => "Preparing local database…",
  );
}

function AuthLayout() {
  const [ready, setReady] = useState(true);
  useEffect(() => setReady(true), []);
  useBusinessConfigLoader();
  const localReady = useLocalReady();
  const progress = useReadinessProgress();
  if (!ready) return null;
  if (!localReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <h1 className="text-lg font-semibold text-foreground">Preparing local database…</h1>
          <p className="mt-2 text-sm text-muted-foreground">{progress}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            Loading all historical invoices, purchases and stock so reports stay accurate.
            This runs once and only takes a moment.
          </p>
        </div>
      </div>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}


