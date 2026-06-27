import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES } from "@/lib/categories";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await supabase
        .from("categories" as any)
        .select("name, sort_order")
        .is("deleted_at", null)
        .order("sort_order")
        .order("name");
      const names = (data ?? []).map((r: any) => r.name as string);
      return names.length ? names : [...CATEGORIES];
    },
    staleTime: 5 * 60_000,
  });
}
