import { useEffect } from "react";
import { registerPwa } from "./register";
import { scheduleBackgroundSync } from "./sync";
import { supabase } from "@/integrations/supabase/client";
import { installOfflineFetchInterceptor } from "./fetch-interceptor";
import { flushOutbox, scheduleOutboxFlush } from "./outbox";

/**
 * Bootstraps offline capability:
 *   1. Registers the service worker (production, guarded).
 *   2. Installs the global fetch interceptor so Supabase writes queue when
 *      the browser is offline or the network fails.
 *   3. Hydrates IndexedDB from Supabase after login and whenever the browser
 *      regains network, and flushes any queued writes on reconnect.
 */
export function PwaBootstrap() {
  useEffect(() => {
    installOfflineFetchInterceptor();
    void registerPwa();

    let cancelled = false;
    const kickIfAuthed = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) {
        scheduleBackgroundSync();
        scheduleOutboxFlush(500);
      }
    };
    void kickIfAuthed();

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        scheduleBackgroundSync();
        scheduleOutboxFlush(500);
      }
    });

    const onOnline = () => {
      scheduleBackgroundSync();
      void flushOutbox();
    };
    window.addEventListener("online", onOnline);

    // Periodic safety-net flush (handles missed online events, backoff retries).
    const iv = window.setInterval(() => {
      if (navigator.onLine) void flushOutbox();
    }, 30_000);

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.clearInterval(iv);
    };
  }, []);

  return null;
}

