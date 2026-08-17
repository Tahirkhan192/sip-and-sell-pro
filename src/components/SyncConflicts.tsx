/**
 * PHASE 9 — human conflict resolution.
 *
 * Both versions are shown side by side. Nothing is ever chosen automatically,
 * and neither version is destroyed: "Keep mine" re-applies the local change on
 * top of the current cloud row, "Keep cloud" withdraws the local change from
 * the queue while the record (and both versions) stay as an audit trail.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Cloud, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  listConflicts,
  resolveConflictKeepCloud,
  resolveConflictKeepLocal,
  type OutboxRow,
} from "@/data/sync/outbox";
import { syncNow } from "@/data/sync/sync-engine";

type Details = {
  reason?: string;
  columns?: string[];
  localPayload?: Record<string, unknown>;
  localBaseline?: Record<string, unknown> | null;
  cloudRow?: Record<string, unknown> | null;
  detectedAt?: string;
};

function parseDetails(raw: string | null): Details {
  if (!raw) return {};
  try {
    return (JSON.parse(raw) ?? {}) as Details;
  } catch {
    return {};
  }
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SyncConflicts() {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listConflicts());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (record: OutboxRow, keep: "local" | "cloud") => {
    setBusy(record.id);
    try {
      if (keep === "local") {
        await resolveConflictKeepLocal(record);
        await syncNow();
        toast.success("Your version was re-sent to the cloud.");
      } else {
        await resolveConflictKeepCloud(record);
        toast.success("The cloud version was kept.");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The conflict could not be resolved.");
    } finally {
      setBusy(null);
    }
  };

  const count = rows.length;
  const title = useMemo(
    () => (count === 0 ? "No conflicts" : `${count} change${count === 1 ? "" : "s"} need a decision`),
    [count],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Sync conflicts
          </CardTitle>
          <CardDescription>{title}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every change on this device agrees with the cloud.
          </p>
        ) : (
          rows.map((record) => {
            const details = parseDetails(record.conflict_details);
            const columns =
              details.columns && details.columns.length > 0
                ? details.columns
                : Object.keys(details.localPayload ?? {});
            return (
              <div key={record.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{record.entity}</Badge>
                  <Badge variant="secondary">{record.operation_type}</Badge>
                  <span className="text-xs text-muted-foreground">
                    device {record.device_id.slice(0, 8)} · {new Date(record.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm">{details.reason ?? record.last_error}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-1 pr-3">Field</th>
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center gap-1">
                            <Smartphone className="h-3 w-3" /> This device
                          </span>
                        </th>
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center gap-1">
                            <Cloud className="h-3 w-3" /> Cloud
                          </span>
                        </th>
                        <th className="py-1">Was</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((column) => (
                        <tr key={column} className="border-t">
                          <td className="py-1 pr-3 font-medium">{column}</td>
                          <td className="py-1 pr-3">{show(details.localPayload?.[column])}</td>
                          <td className="py-1 pr-3">{show(details.cloudRow?.[column])}</td>
                          <td className="py-1 text-muted-foreground">
                            {show(details.localBaseline?.[column])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy === record.id}
                    onClick={() => void resolve(record, "local")}
                  >
                    Keep my version
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === record.id}
                    onClick={() => void resolve(record, "cloud")}
                  >
                    Keep cloud version
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export default SyncConflicts;
