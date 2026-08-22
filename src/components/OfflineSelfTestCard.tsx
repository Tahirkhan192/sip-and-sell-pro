/**
 * Settings card: proves that every kind of entry saves on this computer with
 * no internet. Each test writes a record, reads it back and deletes it again.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2, WifiOff, XCircle } from "lucide-react";
import { runOfflineSelfTest, type SelfTestResult } from "@/lib/offline-selftest";

export function OfflineSelfTestCard() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SelfTestResult[] | null>(null);

  async function run() {
    setRunning(true);
    setResults(null);
    try {
      setResults(await runOfflineSelfTest());
    } finally {
      setRunning(false);
    }
  }

  const allOk = results?.every((r) => r.ok);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WifiOff className="h-4 w-4" /> Offline self-test
        </CardTitle>
        <CardDescription>
          Checks that sales, purchases, money movements, stock transfers, expenses and delivery expenses can be saved on
          this computer without internet. Test records are removed automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={run} disabled={running}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {running ? "Testing…" : "Run self-test"}
        </Button>

        {results ? (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.label} className="flex items-start gap-2 text-sm">
                {r.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                )}
                <div>
                  <div className="font-medium">{r.label}</div>
                  {r.error ? <div className="text-destructive break-all">{r.error}</div> : null}
                </div>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">
              {allOk
                ? "All entry types save locally. No internet is needed to record anything."
                : "Some entry types failed — the message above is the exact reason."}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
