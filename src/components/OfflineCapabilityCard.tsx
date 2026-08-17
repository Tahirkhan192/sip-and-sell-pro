/**
 * PHASE 10 — "Offline capability" in Settings.
 *
 * Tells the owner the truth, per screen: what keeps working with no Internet,
 * what only partly works, and what needs the cloud. It also surfaces the live
 * cutover health gate (integrity check, enrolled identity, verified seed) so a
 * degraded local database is visible instead of silent.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localReadHealth, type LocalHealth } from "@/data/repo/health";
import {
  SCREEN_CAPABILITY,
  offlineReadinessPercent,
  operationsByClass,
  type OfflineCapability,
} from "@/data/repo/operations";

const TONE: Record<OfflineCapability, string> = {
  "fully-offline": "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  "partially-offline": "bg-amber-500/15 text-amber-600 border-amber-500/30",
  "cloud-only": "bg-muted text-muted-foreground border-border",
};

const LABEL: Record<OfflineCapability, string> = {
  "fully-offline": "Works offline",
  "partially-offline": "Partly offline",
  "cloud-only": "Needs Internet",
};

export function OfflineCapabilityCard() {
  const [health, setHealth] = useState<LocalHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const check = async (force = false) => {
    setBusy(true);
    try {
      setHealth(await localReadHealth(force));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void check(false);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const counts = operationsByClass();

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">Offline capability</h3>
            <p className="text-sm text-muted-foreground">
              {offlineReadinessPercent()}% of screens keep working without Internet.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{online ? "Online" : "Offline"}</Badge>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void check(true)}>
              {busy ? "Checking…" : "Re-check"}
            </Button>
          </div>
        </div>

        <div className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Local database</span>
            <Badge variant={health?.usable ? "default" : "secondary"}>
              {health ? (health.usable ? "Authoritative" : "Cloud fallback") : "Checking…"}
            </Badge>
          </div>
          {health && !health.usable && (
            <p className="mt-1 text-muted-foreground">{health.reason}</p>
          )}
          {health && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
              {Object.entries(health.checks).map(([key, ok]) => (
                <span key={key}>
                  {ok ? "✓" : "✗"} {key}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Stat label="Local" value={counts.LOCAL.length} />
          <Stat label="Local + sync" value={counts["LOCAL+SYNC"].length} />
          <Stat label="Cloud (mirrored)" value={counts.CLOUD.length} />
          <Stat label="Cloud only" value={counts["CLOUD-ONLY"].length} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3">Screen</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Needs Internet for</th>
              </tr>
            </thead>
            <tbody>
              {SCREEN_CAPABILITY.map((s) => (
                <tr key={s.path} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3 font-medium">{s.label}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded border px-2 py-0.5 text-xs ${TONE[s.capability]}`}>
                      {LABEL[s.capability]}
                    </span>
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {s.cloudOnly.length ? s.cloudOnly.join(" · ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}
