import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { buildRange, subscribeBusinessConfig, type Preset, type RangeResult } from "@/lib/business-date";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "custom", label: "Custom" },
];

export function useDateRangeFilter(defaultPreset: Preset = "month") {
  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const init = buildRange(defaultPreset);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [range, setRange] = useState<RangeResult>(init);
  const [configTick, setConfigTick] = useState(0);

  useEffect(() => {
    const unsub = subscribeBusinessConfig(() => setConfigTick((n) => n + 1));
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    if (preset !== "custom") {
      const r = buildRange(preset);
      setFrom(r.from); setTo(r.to); setRange(r);
    } else {
      setRange(buildRange("custom", from, to));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, configTick]);

  function applyCustom() {
    setRange(buildRange("custom", from, to));
  }

  const el = (
    <div className="flex flex-wrap items-end gap-2 mb-4">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <Button key={p.id} size="sm" variant={preset === p.id ? "default" : "outline"} onClick={() => setPreset(p.id)}>
            {p.label}
          </Button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button size="sm" onClick={applyCustom}>Apply</Button>
        </div>
      )}
      <div className="text-xs text-muted-foreground ml-auto">Business day rollover configurable in Settings</div>
    </div>
  );

  return { preset, setPreset, range, el };
}
