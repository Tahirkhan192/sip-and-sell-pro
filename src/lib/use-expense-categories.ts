import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { expenseCategoriesRepository } from "@/repositories";

export type ExpenseCategoryRow = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

export function useExpenseCategories(opts: { activeOnly?: boolean } = { activeOnly: true }) {
  return useQuery({
    queryKey: ["expense_categories", opts.activeOnly ?? true],
    queryFn: async () => {
      let q = expenseCategoriesRepository.query()
        .select("id, name, active, sort_order")
        .is("deleted_at", null)
        .order("sort_order")
        .order("name");
      if (opts.activeOnly) q = q.eq("active", true);
      const { data } = await q;
      return (data ?? []) as ExpenseCategoryRow[];
    },
    staleTime: 30_000,
  });
}

export function useExpenseCategoryMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["expense_categories"] });

  const add = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await expenseCategoriesRepository.query().insert({ name: name.trim() });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Category added"); },
    onError: (e: any) => toast.error(e.message),
  });
  const rename = useMutation({
    mutationFn: async (p: { id: string; name: string }) => {
      const { error } = await expenseCategoriesRepository.query().update({ name: p.name.trim() }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Renamed"); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: async (p: { id: string; active: boolean }) => {
      const { error } = await expenseCategoriesRepository.query().update({ active: p.active }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await expenseCategoriesRepository.query().update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Deleted"); },
  });

  return { add, rename, toggle, remove };
}
