import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
function supabaseFor(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_recent_sales",
  title: "List recent sales",
  description: "List recent sales invoices (by business date, newest first). Returns invoice number, business date, business time, customer, payment method, and grand total.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).default(20).describe("How many invoices to return (max 200)."),
    from_business_date: z.string().optional().describe("Inclusive lower bound business date, YYYY-MM-DD."),
    to_business_date: z.string().optional().describe("Inclusive upper bound business date, YYYY-MM-DD."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, from_business_date, to_business_date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseFor(ctx);
    let q =supabase.from("sales")
      .select("invoice_no, business_date, sale_date, customer_name, payment_method, grand_total, status")
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("sale_date", { ascending: false })
      .limit(limit);
    if (from_business_date) q = q.gte("business_date", from_business_date);
    if (to_business_date) q = q.lte("business_date", to_business_date);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});
