import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getBusinessConfig, parseTimeString, setBusinessConfig } from "@/lib/business-date";

export type SettingsRow = {
  id: number;
  allow_negative_stock: boolean | null;
  timezone: string | null;
  business_day_start_time: string | null;
  business_month_start_day: number | null;
  whatsapp_token?: string | null;
  whatsapp_phone_id?: string | null;
  whatsapp_business_id?: string | null;
  whatsapp_country_code?: string | null;
  whatsapp_auto_send?: boolean | null;
};

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase.from("settings" as any).select("*").eq("id", 1).maybeSingle();
      return (data ?? null) as SettingsRow | null;
    },
    staleTime: 60_000,
  });
}

/** Loads settings and pushes tz / rollover / month-start into the business-date module.
 *  When any of these change, invalidates all date-dependent queries so every report,
 *  dashboard tile and filtered list re-computes using the new Business Date / Business Month. */
export function useBusinessConfigLoader() {
  const { data } = useSettings();
  const qc = useQueryClient();
  useEffect(() => {
    if (!data) return;
    const { hour, minute } = parseTimeString(data.business_day_start_time ?? "08:00");
    const nextTz = data.timezone || "Asia/Karachi";
    const nextMonthStart = data.business_month_start_day || 6;
    const prev = getBusinessConfig();
    const changed =
      prev.timezone !== nextTz ||
      prev.startHour !== hour ||
      prev.startMinute !== minute ||
      prev.monthStartDay !== nextMonthStart;
    setBusinessConfig({
      timezone: nextTz,
      startHour: hour,
      startMinute: minute,
      monthStartDay: nextMonthStart,
    });
    if (changed) {
      // Every business-date-scoped query must recompute with the new config.
      const keys = [
        "report", "sales", "dashboard", "daily_closing", "purchases",
        "expenses", "cash_movements", "delivery_expenses", "category_monthly",
        "monthly_summary", "products", "stock_items", "recipes", "stock_transfers",
      ];
      for (const k of keys) qc.invalidateQueries({ queryKey: [k] });
    }
  }, [data, qc]);
}
