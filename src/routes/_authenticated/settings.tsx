import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { saveBusinessSettings, saveAllowNegativeStock, savePinSettings } from "@/data/writes/master";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";
import { changeStockPin } from "@/lib/stock-pin";
import { PIN_MODULES, DEFAULT_PIN_LOCKS } from "@/lib/pin-locks";
import { DuplicateInvoiceManager } from "@/components/DuplicateInvoiceManager";
import { BackupCard } from "@/components/BackupCard";
import { LocalDbCard } from "@/components/LocalDbCard";
import { LocalBackupCard } from "@/components/LocalBackupCard";
import { CloudSeedCard } from "@/components/CloudSeedCard";
import { SyncStatusCard } from "@/components/SyncStatusCard";
import { SyncConflicts } from "@/components/SyncConflicts";
import { ALWAYS_VISIBLE, MENU_MODULES, useMenuVisibility, useSaveMenuVisibility } from "@/lib/menu-visibility";


import {
  businessToday,
  formatInTZ,
  getBusinessConfig,
  parseTimeString,
  setBusinessConfig,
  subscribeBusinessConfig,
} from "@/lib/business-date";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

const TZ_OPTIONS = [
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Riyadh",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Asia/Tehran",
  "Asia/Kabul",
  "Asia/Dhaka",
  "Asia/Colombo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

function LiveClock() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((x) => x + 1), 1000);
    const u = subscribeBusinessConfig(() => setTick((x) => x + 1));
    return () => { clearInterval(i); u(); };
  }, []);
  const cfg = getBusinessConfig();
  const now = new Date();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm" data-tick={tick}>
      <div className="rounded border p-3">
        <div className="text-xs text-muted-foreground">Current Date</div>
        <div className="font-semibold">{formatInTZ(now, { day: "2-digit", month: "2-digit", year: "numeric" })}</div>
        <div className="text-[10px] text-muted-foreground mt-1">{cfg.timezone}</div>
      </div>
      <div className="rounded border p-3">
        <div className="text-xs text-muted-foreground">Current Time</div>
        <div className="font-semibold">{formatInTZ(now, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}</div>
        <div className="text-[10px] text-muted-foreground mt-1">Rollover {String(cfg.startHour).padStart(2, "0")}:{String(cfg.startMinute).padStart(2, "0")}</div>
      </div>
      <div className="rounded border p-3">
        <div className="text-xs text-muted-foreground">Current Business Date</div>
        <div className="font-semibold">{businessToday(now)}</div>
        <div className="text-[10px] text-muted-foreground mt-1">Month starts on day {cfg.monthStartDay}</div>
      </div>
    </div>
  );
}

function BusinessSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings" as any).select("*").eq("id", 1).maybeSingle()).data as any,
  });

  const [tz, setTz] = useState<string>("Asia/Karachi");
  const [startTime, setStartTime] = useState<string>("08:00");
  const [monthStart, setMonthStart] = useState<number>(6);

  useEffect(() => {
    if (!data) return;
    setTz(data.timezone || "Asia/Karachi");
    setStartTime((data.business_day_start_time || "08:00").slice(0, 5));
    setMonthStart(data.business_month_start_day || 6);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      await saveBusinessSettings({
        timezone: tz,
        business_day_start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
        business_month_start_day: monthStart,
      });
    },
    onSuccess: () => {
      // Apply immediately, then refresh all reports/dashboard/sales/etc.
      const { hour, minute } = parseTimeString(startTime);
      setBusinessConfig({ timezone: tz, startHour: hour, startMinute: minute, monthStartDay: monthStart });
      toast.success("Business settings saved");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <h3 className="text-base font-semibold">Business Settings</h3>
          <p className="text-xs text-muted-foreground">Time zone, business day rollover time, and business month start day. All reports, invoices, purchases, and daily closing use these settings.</p>
        </div>

        <LiveClock />

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Time Zone</Label>
            <Select value={tz} onValueChange={setTz}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TZ_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Business Date Changes At</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Sales before this time count under the previous business date.</p>
          </div>
          <div className="space-y-1">
            <Label>Business Month Starts On (Day)</Label>
            <Input type="number" min={1} max={28} value={monthStart} onChange={(e) => setMonthStart(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} />
            <p className="text-[10px] text-muted-foreground">1–28. Monthly reports will run from this day.</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save Business Settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const [allowNeg, setAllowNeg] = useState(false);
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings" as any).select("*").eq("id", 1).maybeSingle()).data,
  });
  useEffect(() => { if (data) setAllowNeg(!!(data as any).allow_negative_stock); }, [data]);

  const save = useMutation({
    mutationFn: async (v: boolean) => {
      await saveAllowNegativeStock(v);
    },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Settings" subtitle="Owner controls" />

      <BusinessSettings />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-base">Allow negative stock</Label>
              <p className="text-xs text-muted-foreground mt-1">When ON, sales can be saved even if a product (or any recipe component) goes below zero. When OFF, the sale is blocked.</p>
            </div>
            <Switch checked={allowNeg} onCheckedChange={(v) => { setAllowNeg(v); save.mutate(v); }} />
          </div>
        </CardContent>
      </Card>

      <StockPinCard />

      <LocalBackupCard />

      <BackupCard />

      <LocalDbCard />
      <CloudSeedCard />
      <SyncStatusCard />
      <SyncConflicts />

      <MenuVisibilityCard />

      <PinLockCard />

      <DuplicateInvoiceManager />
    </div>


  );
}

function StockPinCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (next !== confirmPin) { toast.error("New PIN and confirmation don't match"); return; }
    setBusy(true);
    try {
      const res = await changeStockPin(current, next);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Stock Security PIN updated");
      setCurrent(""); setNext(""); setConfirmPin("");
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <Label className="text-base">Stock Security PIN</Label>
          <p className="text-xs text-muted-foreground mt-1">Required when manually editing Current Stock on Products or Stock Items. Default PIN is <code>1234</code>. Changing the PIN requires the current PIN.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Current PIN</Label><Input type="password" inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div className="space-y-1"><Label>New PIN</Label><Input type="password" inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div className="space-y-1"><Label>Confirm New PIN</Label><Input type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} /></div>
        </div>
        <div className="flex justify-end">
          <Button onClick={submit} disabled={busy || !current || !next || !confirmPin}>Update PIN</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Owner chooses exactly which modules require the PIN, plus the staff invoice colour. */
function PinLockCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings", "pin-locks-card"],
    queryFn: async () => (await supabase.from("settings" as any).select("pin_locks, staff_invoice_color").eq("id", 1).maybeSingle()).data as any,
  });

  const [locks, setLocks] = useState<Record<string, boolean>>(DEFAULT_PIN_LOCKS);
  const [color, setColor] = useState("#DBEAFE");

  useEffect(() => {
    if (!data) return;
    const raw = (data.pin_locks ?? null) as Record<string, boolean> | null;
    setLocks(raw && Object.keys(raw).length > 0 ? raw : { ...DEFAULT_PIN_LOCKS });
    setColor(data.staff_invoice_color || "#DBEAFE");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      await savePinSettings({ pin_locks: locks, staff_invoice_color: color });
    },
    onSuccess: () => {
      toast.success("PIN protection settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <Label className="text-base">PIN Protected Modules</Label>
          <p className="text-xs text-muted-foreground mt-1">Tick each module that must ask for the PIN. Unticked modules are not protected.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {PIN_MODULES.map((m) => (
            <label key={m.key} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
              <span>{m.label}</span>
              <Switch checked={!!locks[m.key]} onCheckedChange={(v) => setLocks((s) => ({ ...s, [m.key]: v }))} />
            </label>
          ))}
        </div>

        <div className="space-y-1">
          <Label>Staff Invoice Colour</Label>
          <div className="flex items-center gap-3">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 rounded border bg-transparent" />
            <Input className="max-w-[160px]" value={color} onChange={(e) => setColor(e.target.value)} />
            <span className="rounded border px-3 py-1 text-xs" style={{ backgroundColor: color }}>Staff invoice preview</span>
          </div>
          <p className="text-[10px] text-muted-foreground">All invoices linked to a staff member are highlighted with this colour. Customer invoices are unchanged.</p>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save PIN Settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Owner chooses which modules appear in the sidebar / are reachable. */
function MenuVisibilityCard() {
  const { data } = useMenuVisibility();
  const save = useSaveMenuVisibility();
  const [map, setMap] = useState<Record<string, boolean>>({});

  useEffect(() => { if (data) setMap(data); }, [data]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <Label className="text-base">Menu Visibility</Label>
          <p className="text-xs text-muted-foreground mt-1">Turn modules ON or OFF. Hidden modules disappear from the sidebar and cannot be opened. No data is deleted — records and existing logic keep working.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {MENU_MODULES.filter((m) => !ALWAYS_VISIBLE.has(m.key)).map((m) => (
            <label key={m.key} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
              <span>{m.label}</span>
              <Switch checked={map[m.key] !== false} onCheckedChange={(v) => setMap((s) => ({ ...s, [m.key]: v }))} />
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(map, {
                onSuccess: (r) => toast.success(r.persisted ? "Menu visibility saved" : "Menu visibility saved on this device"),
                onError: () => toast.success("Menu visibility saved on this device"),
              })
            }
          >
            Save Menu Visibility
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
