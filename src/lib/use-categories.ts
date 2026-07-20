import { useQuery } from "@tanstack/react-query";
import { CATEGORIES } from "@/lib/categories";
import { categoriesRepository } from "@/repositories";

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
      let q =categoriesRepository.query()
        .select("name, sort_order, active")
        .is("deleted_at", null)
        .order("sort_order")
        .order("name");
      if (opts.activeOnly) q = q.eq("active", true);
      const { data } = await q;
      const names = (data ?? []).map((r: any) => r.name as string);
      return names.length ? names : [...CATEGORIES];
    },
    staleTime: 60_000,
  });
}

export function useCategoryRows() {
  return useQuery({
    queryKey: ["categories", "rows"],
    queryFn: async () => {
      const { data } = await categoriesRepository.query()
        .select("*")
        .is("deleted_at", null)
        .order("sort_order")
        .order("name");
      return (data ?? []) as unknown as CategoryRow[];
    },
    staleTime: 30_000,
  });
}
