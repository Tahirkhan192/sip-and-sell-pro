import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { verifyStockPin } from "@/lib/stock-pin";
import { toast } from "sonner";

export function StockPinDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Enter PIN",
  description = "Manual Current Stock edits are protected. Enter your Stock Security PIN to continue.",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setPin(""); }, [open]);

  async function confirm() {
    setBusy(true);
    try {
      const ok = await verifyStockPin(pin);
      if (!ok) {
        toast.error("Invalid PIN");
        return;
      }
      onOpenChange(false);
      onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{description}</p>
        <div className="space-y-1">
          <Label>Enter PIN</Label>
          <Input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={confirm} disabled={busy || !pin}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
