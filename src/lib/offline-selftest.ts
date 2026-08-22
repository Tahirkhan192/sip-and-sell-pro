/**
 * Offline self-test.
 *
 * Writes one throw-away record for every kind of entry the shop saves, reads it
 * back and removes it again — all against the embedded local database on this
 * computer. If every line says OK, saving works with the internet switched off.
 *
 * Nothing here touches the network, and no test record is left behind.
 */

import { supabase } from "@/integrations/supabase/client";

export type SelfTestResult = { label: string; ok: boolean; error?: string };

type Check = { label: string; run: () => Promise<void> };

async function insertAndRemove(table: string, row: Record<string, unknown>, extra?: (id: string) => Promise<void>) {
  const db = supabase as any;
  const ins = await db.from(table).insert(row).select("id").single();

  if (ins.error) throw new Error(ins.error.message);
  const id = ins.data?.id as string;
  if (!id) throw new Error("The record was not written.");
  const back = await db.from(table).select("id").eq("id", id).maybeSingle();
  if (back.error) throw new Error(back.error.message);
  if (!back.data) throw new Error("The record could not be read back.");
  try {
    await extra?.(id);
  } finally {
    const del = await db.from(table).delete().eq("id", id);
    if (del.error) throw new Error(`Cleanup failed: ${del.error.message}`);
  }
}

const TEST_NOTE = "OFFLINE SELF-TEST — safe to ignore";

function checks(productId: string | null): Check[] {
  const db = supabase as any;
  return [
    {
      label: "POS sale",
      run: async () => {
        const ins = await db
          .from("sales")
          .insert({ grand_total: 1, cash_paid: 1, status: "completed", customer_name: TEST_NOTE })
          .select("id")
          .single();
        if (ins.error) throw new Error(ins.error.message);
        const saleId = (ins.data as any).id as string;
        try {
          if (productId) {
            const item = await db
              .from("sale_items")
              .insert({ sale_id: saleId, product_id: productId, quantity: 1, price: 1, total: 1 })
              .select("id")
              .single();
            if (item.error) throw new Error(item.error.message);
            await db.from("sale_items").delete().eq("sale_id", saleId);
          }
        } finally {
          await db.from("sales").delete().eq("id", saleId);
        }
      },
    },
    {
      label: "Purchase",
      run: async () => {
        const ins = await db
          .from("purchases")
          .insert({ supplier: TEST_NOTE, grand_total: 1, payment_status: "unpaid", notes: TEST_NOTE })
          .select("id")
          .single();
        if (ins.error) throw new Error(ins.error.message);
        const purchaseId = (ins.data as any).id as string;
        try {
          const item = await db
            .from("purchase_items")
            .insert({ purchase_id: purchaseId, product_id: productId, quantity: 1, unit_cost: 1, total_cost: 1 })
            .select("id")
            .single();
          if (item.error) throw new Error(item.error.message);
          await db.from("purchase_items").delete().eq("purchase_id", purchaseId);
        } finally {
          await db.from("cash_movements").delete().eq("reference_id", purchaseId);
          await db.from("purchases").delete().eq("id", purchaseId);
        }
      },
    },
    {
      label: "Money movement",
      run: () =>
        insertAndRemove("cash_movements", {
          type: "cash_in",
          amount: 1,
          payment_source: "cash",
          movement_category: "transaction",
          notes: TEST_NOTE,
        }),
    },
    {
      label: "Stock transfer",
      run: () =>
        insertAndRemove("stock_transfers", {
          item_type: productId ? "product" : "stock_item",
          product_id: productId,
          item_name: TEST_NOTE,
          from_category: "Test",
          to_category: "Test",
          quantity: 0,
          unit_cost: 0,
          total_cost: 0,
          notes: TEST_NOTE,
        }),
    },
    {
      label: "Expense",
      run: () =>
        insertAndRemove("expenses", {
          category: "Miscellaneous",
          amount: 1,
          description: TEST_NOTE,
          payment_method: "cash",
          payment_status: "paid",
        }),
    },
    {
      label: "Delivery expense",
      run: () =>
        insertAndRemove("delivery_expenses", {
          fuel_cost: 1,
          maintenance_cost: 0,
          description: TEST_NOTE,
          payment_status: "unpaid",
        }),
    },
  ];
}

/** Runs every write test and returns one line per entry type. */
export async function runOfflineSelfTest(): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  let productId: string | null = null;
  try {
    const p = await (supabase as any).from("products").select("id").is("deleted_at", null).limit(1).maybeSingle();
    productId = (p.data as any)?.id ?? null;
  } catch {
    /* the sale test simply runs without an item line */
  }
  for (const check of checks(productId)) {
    try {
      await check.run();
      results.push({ label: check.label, ok: true });
    } catch (err) {
      results.push({ label: check.label, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
