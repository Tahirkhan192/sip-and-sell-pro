import { useEffect } from "react";
import { registerPwa } from "./register";
import { scheduleBackgroundSync } from "./sync";
import { supabase } from "@/integrations/supabase/client";

/**
 * Bootstraps offline capability:
 *   1. Registers the service worker (only in production, guarded).
 *   2. Hydrates IndexedDB from Supabase after login and whenever the browser
 *      regains network. Purely additive — routes still read/write to Supabase
 *      directly today; the SW's runtime cache serves offline reads.
 */
export function PwaBootstrap() {
  useEffect(() => {
    void registerPwa();

    let cancelled = false;
    const kickIfAuthed = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) scheduleBackgroundSync();
    };
    void kickIfAuthed();

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        scheduleBackgroundSync();
      }
    });

    const onOnline = () => scheduleBackgroundSync();
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
