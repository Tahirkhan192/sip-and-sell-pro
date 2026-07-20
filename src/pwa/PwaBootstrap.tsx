import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { registerPwa } from "./register";
import { ensureInitialHydration, scheduleBackgroundSync, startPeriodicSync, stopPeriodicSync } from "./sync";
import { supabase } from "@/integrations/supabase/client";
import { installOfflineFetchInterceptor } from "./fetch-interceptor";
import { flushOutbox, scheduleOutboxFlush } from "./outbox";
import { subscribeReadiness, isLocalReady } from "./readiness";
import { subscribeLocalDataChanges } from "./local-events";

/**
 * Bootstraps offline capability:
 *   1. Registers the service worker (production, guarded).
 *   2. Installs the global fetch interceptor so Supabase writes queue when
 *      the browser is offline or the network fails.
 *   3. Hydrates IndexedDB from Supabase after login and whenever the browser
 *      regains network, and flushes any queued writes on reconnect.
 */
export function PwaBootstrap() {
  const qc = useQueryClient();
  useEffect(() => {
    installOfflineFetchInterceptor();
    void registerPwa();

    let cancelled = false;
    const kickIfAuthed = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) {
        void ensureInitialHydration();
        scheduleOutboxFlush(500);
      }
    };
    void kickIfAuthed();

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        void ensureInitialHydration();
        scheduleOutboxFlush(500);
      }
    });

    const onOnline = () => {
      scheduleBackgroundSync();
      void flushOutbox();
    };
    window.addEventListener("online", onOnline);

    // Refresh every mounted query the moment initial hydration finishes so
    // Dashboard / Sales / Reports pick up the newly back-filled rows without
    // any manual refresh.
    let wasReady = isLocalReady();
    const unsubReady = subscribeReadiness(() => {
      if (!wasReady && isLocalReady()) {
        wasReady = true;
        qc.invalidateQueries();
      }
    });
    const unsubLocal = subscribeLocalDataChanges(() => {
      qc.invalidateQueries();
    });

    // Periodic safety-net flush (handles missed online events, backoff retries).
    const iv = window.setInterval(() => {
      if (navigator.onLine) void flushOutbox();
    }, 30_000);
    startPeriodicSync(60_000);

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.clearInterval(iv);
      unsubReady();
      unsubLocal();
      stopPeriodicSync();
    };
  }, [qc]);

  return null;
}


