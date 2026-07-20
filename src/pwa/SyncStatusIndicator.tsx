import { useOnlineStatus } from "./use-online-status";
import { flushOutbox } from "./outbox";
import { syncFromCloud } from "./sync";
import { RefreshCw, WifiOff, Wifi, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function SyncStatusIndicator() {
  const { status, pending } = useOnlineStatus();
  const [running, setRunning] = useState(false);

  const label =
    status === "offline"
      ? pending > 0 ? `Offline (${pending} pending)` : "Offline"
      : status === "syncing"
        ? `Syncing… (${pending})`
        : "Online";

  const Icon = status === "offline" ? WifiOff : status === "syncing" ? RefreshCw : Wifi;
  const dotClass =
    status === "offline"
      ? "text-red-500"
      : status === "syncing"
        ? "text-amber-500"
        : "text-emerald-500";

  const onClick = async () => {
    if (running) return;
    setRunning(true);
    try {
      await flushOutbox();
      await syncFromCloud();
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={running || status === "offline"}
      className="gap-2 h-8 px-2"
      title={label}
    >
      <CircleDot className={cn("h-3 w-3", dotClass)} />
      <Icon className={cn("h-4 w-4", status === "syncing" && "animate-spin")} />
      <span className="hidden sm:inline text-xs font-medium">{label}</span>
    </Button>
  );
}
