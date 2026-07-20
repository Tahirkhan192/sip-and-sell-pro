import { useEffect, useState } from "react";
import { pendingCount, subscribeOutbox } from "./outbox";

export type SyncStatus = "online" | "offline" | "syncing";

export function useOnlineStatus() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [pending, setPending] = useState<number>(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const n = await pendingCount();
      if (!cancelled) setPending(n);
    };
    void refresh();
    const unsub = subscribeOutbox(() => void refresh());
    const iv = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    // Heuristic: if we're online and have pending items we're syncing.
    setSyncing(online && pending > 0);
  }, [online, pending]);

  const status: SyncStatus = !online ? "offline" : pending > 0 ? "syncing" : "online";
  return { online, pending, syncing, status };
}
