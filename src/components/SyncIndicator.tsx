/**
 * PHASE 10 (partial) — global connection / sync indicator.
 *
 * Shows, at every screen, whether the app is ONLINE, OFFLINE, SYNCING or in
 * SYNC ERROR / CONFLICT, plus the pending, failed and conflicted change counts,
 * the last successful sync and the local seed timestamp. Read-only surface: it
 * never triggers a mutation, and "Sync now" only calls the existing engine.
 */

import { useEffect, useState } from "react";
import { CloudOff, Cloud, RefreshCw, AlertTriangle, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getSyncState, refreshSyncCounts, subscribeSync, syncNow, type SyncState } from "@/data/sync/sync-engine";
import { cachedLocalHealth, localReadHealth, type LocalHealth } from "@/data/repo/health";

function label(state: SyncState, health: LocalHealth | null): { text: string; tone: string; Icon: typeof Cloud } {
  if (state.counts.conflict > 0) return { text: "Conflict", tone: "text-destructive", Icon: GitMerge };
  if (state.counts.failed > 0) return { text: "Sync error", tone: "text-destructive", Icon: AlertTriangle };
  if (state.phase === "syncing") return { text: "Syncing", tone: "text-muted-foreground", Icon: RefreshCw };
  if (!state.online) return { text: "Offline", tone: "text-amber-600", Icon: CloudOff };
  if (health && !health.usable) return { text: "Online", tone: "text-muted-foreground", Icon: Cloud };
  return { text: "Online", tone: "text-muted-foreground", Icon: Cloud };
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export function SyncIndicator() {
  const [state, setState] = useState<SyncState>(() => getSyncState());
  const [health, setHealth] = useState<LocalHealth | null>(() => cachedLocalHealth());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = subscribeSync(setState);
    void refreshSyncCounts().catch(() => {});
    void localReadHealth().then(setHealth).catch(() => {});
    return off;
  }, []);

  const { text, tone, Icon } = label(state, health);
  const pending = state.counts.pending + state.counts.syncing;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={`gap-1.5 ${tone}`} aria-label={`Connection status: ${text}`}>
          <Icon className={`h-4 w-4 ${state.phase === "syncing" ? "animate-spin" : ""}`} />
          <span className="hidden text-xs font-medium sm:inline">{text}</span>
          {pending > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
              {pending}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 text-sm">
        <div className="flex items-center justify-between font-medium">
          <span>{state.online ? "Connected" : "No internet"}</span>
          <span className={tone}>{text}</span>
        </div>
        <dl className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between"><dt>Pending changes</dt><dd>{state.counts.pending}</dd></div>
          <div className="flex justify-between"><dt>Failed changes</dt><dd>{state.counts.failed}</dd></div>
          <div className="flex justify-between"><dt>Conflicts</dt><dd>{state.counts.conflict}</dd></div>
          <div className="flex justify-between"><dt>Last sync</dt><dd>{when(state.lastSuccessAt)}</dd></div>
          <div className="flex justify-between"><dt>Local database</dt><dd>{health?.usable ? "Healthy" : health?.reason ?? "Not in use"}</dd></div>
          <div className="flex justify-between"><dt>Seed taken</dt><dd>{when(health?.seededAt ?? null)}</dd></div>
        </dl>
        {state.lastError && <p className="text-xs text-destructive">{state.lastError}</p>}
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={busy || !state.online || state.phase === "syncing"}
          onClick={async () => {
            setBusy(true);
            try {
              await syncNow();
            } finally {
              setBusy(false);
            }
          }}
        >
          Sync now
        </Button>
      </PopoverContent>
    </Popover>
  );
}
