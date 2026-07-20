import { useEffect, useState } from "react";
import { pendingCount, subscribeOutbox } from "./outbox";
import { getSyncState, subscribeSync, type SyncState } from "./sync";

export type SyncStatus = "online" | "offline" | "syncing";

export function useOnlineStatus() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [pending, setPending] = useState<number>(0);
  const [sync, setSync] = useState<SyncState>(() => getSyncState());

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
    const unsub = subscribeSync((s) => setSync(s));
    return () => { unsub(); };
  }, []);

  const isBusy = sync.syncing || (online && pending > 0);
  const status: SyncStatus = !online ? "offline" : isBusy ? "syncing" : "online";

  return {
    online,
    pending,
    syncing: isBusy,
    status,
    lastSyncAt: sync.lastSyncAt,
    progress: sync.progress,
  };
}
