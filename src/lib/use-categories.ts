import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listCategories } from "@/data/reads/reference";
import { CATEGORIES } from "@/lib/categories";

export type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
};

export function useCategories(opts: { activeOnly?: boolean } = { activeOnly: true }) {
  return useQuery({
    queryKey: ["categories", opts.activeOnly ?? true],
    queryFn: async () => {
      const data = await listCategories({ activeOnly: opts.activeOnly });
      const names = data.map((r) => r.name as string);
      return names.length ? names : [...CATEGORIES];
    },
    staleTime: 60_000,
  });
}

export function useCategoryRows() {
  return useQuery({
    queryKey: ["categories", "rows"],
    queryFn: async () => {
      const data = await listCategories();
      return data as unknown as CategoryRow[];
    },
    staleTime: 30_000,
  });
}
