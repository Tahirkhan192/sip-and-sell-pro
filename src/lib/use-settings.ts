import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseTimeString, setBusinessConfig } from "@/lib/business-date";

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

/** Loads settings and pushes tz / rollover / month-start into the business-date module. */
export function useBusinessConfigLoader() {
  const { data } = useSettings();
  useEffect(() => {
    if (!data) return;
    const { hour, minute } = parseTimeString(data.business_day_start_time ?? "08:00");
    setBusinessConfig({
      timezone: data.timezone || "Asia/Karachi",
      startHour: hour,
      startMinute: minute,
      monthStartDay: data.business_month_start_day || 6,
    });
  }, [data]);
}
