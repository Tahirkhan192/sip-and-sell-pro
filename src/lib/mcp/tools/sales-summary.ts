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
  name: "get_sales_summary",
  title: "Sales summary",
  description: "Return total sales, invoice count, and average ticket for a business-date range.",
  inputSchema: {
    from_business_date: z.string().describe("Inclusive start business date, YYYY-MM-DD."),
    to_business_date: z.string().describe("Inclusive end business date, YYYY-MM-DD."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from_business_date, to_business_date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseFor(ctx);
    const { data, error } = awaitsupabase.from("sales")
      .select("grand_total, status")
      .is("deleted_at", null)
      .gte("business_date", from_business_date)
      .lte("business_date", to_business_date);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data ?? []).filter((r: any) => (r.status ?? "completed") !== "pending");
    const totalSales = rows.reduce((s: number, r: any) => s + Number(r.grand_total || 0), 0);
    const invoiceCount = rows.length;
    const avgTicket = invoiceCount ? totalSales / invoiceCount : 0;
    const summary = {
      from_business_date,
      to_business_date,
      total_sales: Number(totalSales.toFixed(2)),
      invoice_count: invoiceCount,
      average_ticket: Number(avgTicket.toFixed(2)),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary) }],
      structuredContent: summary,
    };
  },
});
