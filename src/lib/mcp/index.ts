import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listRecentSales from "./tools/list-recent-sales";
import salesSummary from "./tools/sales-summary";
import listProducts from "./tools/list-products";
import listExpenses from "./tools/list-expenses";

// Use the direct Supabase auth issuer, never the .lovable.cloud proxy.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "cafe-manager-mcp",
  title: "Café Manager MCP",
  version: "0.1.0",
  instructions:
    "Read-only tools for a café POS. All results are scoped to the signed-in user via RLS. Dates use Business Date (YYYY-MM-DD) as configured in Business Settings.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listRecentSales, salesSummary, listProducts, listExpenses],
});
