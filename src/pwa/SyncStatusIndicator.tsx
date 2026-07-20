import { useOnlineStatus } from "./use-online-status";
import { flushOutbox } from "./outbox";
import { syncFromCloud } from "./sync";
import { RefreshCw, WifiOff, Wifi, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useState } from "react";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "never";
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function SyncStatusIndicator() {
  const { status, pending, lastSyncAt, progress } = useOnlineStatus();
  const [running, setRunning] = useState(false);

  const shortLabel =
    status === "offline"
      ? pending > 0 ? `Offline · ${pending}` : "Offline"
      : status === "syncing"
        ? progress
          ? `Syncing ${progress.done}/${progress.total}`
          : pending > 0 ? `Syncing · ${pending}` : "Syncing"
        : "Online";

  const Icon = status === "offline" ? WifiOff : status === "syncing" ? RefreshCw : Wifi;
  const dotClass =
    status === "offline"
      ? "text-red-500"
      : status === "syncing"
        ? "text-amber-500"
        : "text-emerald-500";

  const onSyncNow = async () => {
    if (running || status === "offline") return;
    setRunning(true);
    try {
      await flushOutbox();
      await syncFromCloud();
    } finally {
      setRunning(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 h-8 px-2"
          title={shortLabel}
        >
          <CircleDot className={cn("h-3 w-3", dotClass)} />
          <Icon className={cn("h-4 w-4", status === "syncing" && "animate-spin")} />
          <span className="hidden sm:inline text-xs font-medium">{shortLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-sm">
        <div className="flex items-center gap-2">
          <CircleDot className={cn("h-3 w-3", dotClass)} />
          <span className="font-medium capitalize">{status}</span>
        </div>
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Pending changes</span>
            <span className="tabular-nums text-foreground">{pending}</span>
          </div>
          <div className="flex justify-between">
            <span>Last sync</span>
            <span className="tabular-nums text-foreground">{relativeTime(lastSyncAt)}</span>
          </div>
          {progress ? (
            <div className="flex justify-between">
              <span>Progress</span>
              <span className="tabular-nums text-foreground">
                {progress.done}/{progress.total}
                {progress.table ? ` · ${progress.table}` : ""}
              </span>
            </div>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 w-full h-8"
          onClick={onSyncNow}
          disabled={running || status === "offline"}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", running && "animate-spin")} />
          Sync now
        </Button>
      </PopoverContent>
    </Popover>
  );
}
