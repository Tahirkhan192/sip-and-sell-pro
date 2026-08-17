/**
 * PHASE 5D — "Sync Status" in Settings.
 *
 * Shows only what an owner needs: are we online, how many changes are waiting,
 * did anything fail or clash, and when did the last upload succeed. Nothing is
 * ever deleted from here — failed changes can be retried, conflicts are kept
 * with both versions for a later resolution screen.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  getSyncState,
  refreshSyncCounts,
  retryFailedNow,
  subscribeSync,
  syncNow,
  type SyncState,
} from "@/data/sync/sync-engine";
import { listOutbox, type OutboxRow } from "@/data/sync/outbox";

function when(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function SyncStatusCard() {
  const [state, setState] = useState<SyncState>(getSyncState());
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<OutboxRow[]>([]);

  useEffect(() => subscribeSync(setState), []);

  const loadProblems = async () => {
    try {
      setProblems(await listOutbox({ statuses: ["failed", "conflict"], limit: 20 }));
    } catch {
      setProblems([]);
    }
  };

  useEffect(() => {
    void refreshSyncCounts();
    void loadProblems();
    const i = setInterval(() => {
      void refreshSyncCounts();
      void loadProblems();
    }, 15_000);
    return () => clearInterval(i);
  }, []);

  const status = useMemo(() => {
    if (!state.online) return { label: "Offline", tone: "secondary" as const };
    if (state.phase === "syncing") return { label: "Syncing…", tone: "default" as const };
    if (state.counts.conflict > 0) return { label: "Needs review", tone: "destructive" as const };
    if (state.counts.failed > 0) return { label: "Retrying", tone: "destructive" as const };
    if (state.counts.pending > 0) return { label: "Waiting to sync", tone: "secondary" as const };
    return { label: "Up to date", tone: "default" as const };
  }, [state]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await refreshSyncCounts();
      await loadProblems();
      toast.success(done);
    } catch (e: any) {
      toast.error(e?.message ?? "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Label className="text-base">Sync Status</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Master data (categories, products, customers, staff and similar) saves on this device
              first, then uploads automatically. Sales and other daily transactions always save
              online.
            </p>
          </div>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {(["pending", "syncing", "failed", "conflict"] as const).map((key) => (
            <div key={key} className="rounded-md border p-2">
              <div className="text-lg font-semibold">{state.counts[key]}</div>
              <div className="text-[11px] text-muted-foreground capitalize">
                {key === "conflict" ? "conflicts" : key}
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>Last sync attempt: {when(state.lastRunAt)}</div>
          <div>Last successful sync: {when(state.lastSuccessAt)}</div>
          {state.lastError ? <div className="text-destructive">{state.lastError}</div> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => run(() => syncNow(), "Sync finished")}>
            Sync now
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || state.counts.failed === 0}
            onClick={() => run(() => retryFailedNow(), "Failed changes queued again")}
          >
            Retry failed changes
          </Button>
        </div>

        {problems.length > 0 ? (
          <div className="space-y-1">
            <div className="text-xs font-medium">Needs attention</div>
            <div className="rounded-md border divide-y max-h-56 overflow-auto">
              {problems.map((row) => (
                <div key={row.id} className="p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {row.entity} · {row.operation_type}
                    </span>
                    <Badge variant={row.status === "conflict" ? "destructive" : "secondary"}>
                      {row.status}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 break-words">
                    {row.last_error ?? "Waiting to retry"}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Attempts: {row.attempt_count} · Saved: {when(row.created_at)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Conflicting changes are kept safely with both versions and are never overwritten.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
