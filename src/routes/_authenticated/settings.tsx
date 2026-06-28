import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

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
      const { error } = await supabase.from("settings" as any).upsert({ id: 1, allow_negative_stock: v, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Settings" subtitle="Owner controls" />
      <Card className="max-w-xl">
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
    </div>
  );
}
