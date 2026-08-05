import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function CrudDialog({
  title,
  trigger,
  children,
  onSubmit,
  open: controlledOpen,
  onOpenChange,
}: {
  title: string;
  trigger?: ReactNode;
  children: ReactNode;
  onSubmit: () => Promise<boolean> | boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [uOpen, setUOpen] = useState(false);
  const open = controlledOpen ?? uOpen;
  const setOpen = onOpenChange ?? setUOpen;
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onSubmit();
              setBusy(false);
              if (ok) setOpen(false);
            }}
          >Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddButton({ children = "Add", onClick }: { children?: ReactNode; onClick?: () => void }) {
  return <Button onClick={onClick}><Plus className="h-4 w-4 mr-1" />{children}</Button>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2 [&>div]:flex-wrap">{action}</div>}
    </div>
  );
}
