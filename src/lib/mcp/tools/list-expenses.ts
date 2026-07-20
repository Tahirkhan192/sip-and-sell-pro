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
  name: "list_expenses",
  title: "List expenses",
  description: "List expenses within a business-date range.",
  inputSchema: {
    from_business_date: z.string().describe("Inclusive start business date, YYYY-MM-DD."),
    to_business_date: z.string().describe("Inclusive end business date, YYYY-MM-DD."),
    limit: z.number().int().min(1).max(500).default(100),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from_business_date, to_business_date, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseFor(ctx);
    const { data, error } = awaitsupabase.from("expenses")
      .select("id, business_date, category, amount, notes, payment_method")
      .is("deleted_at", null)
      .gte("business_date", from_business_date)
      .lte("business_date", to_business_date)
      .order("business_date", { ascending: false })
      .limit(limit);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});
