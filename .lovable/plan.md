# Complete Migration to IndexedDB-Only Runtime

Audit (right now):
- **60 direct cloud read/write sites** across **17 files**: `use-settings.ts` + 16 routes (`pos`, `products`, `categories`, `customers`, `suppliers` via customers, `purchases`, `expenses`, `cash-movements`, `sales`, `daily-closing`, `recipes`, `stock`, `stock-items`, `stock-transfer`, `production`, `settings`, `delivery-expenses`).
- Writes are already local-first (fetch interceptor mirrors CUD to IndexedDB and enqueues to cloud).
- Reads still go to the network: `supabase.from(x).select(...)`. Many use PostgREST embeds (`products(name, category)`, `sales!inner(...)`, `parent:products!recipes_...`).

## The Approach — Two Layers

Doing 60 UI rewrites in one turn is high-risk. I'll ship both layers so the app is fully local-first immediately, then progressively route pages through the named repository without user-visible change.

### Layer 1 — GET interceptor (makes everything local NOW)

Extend `src/pwa/fetch-interceptor.ts` so `GET /rest/v1/<table>?...` is served entirely from IndexedDB. This flips the whole app to zero runtime cloud reads in one edit.

Supported PostgREST query surface (covers every call site observed in the audit):

| Feature | Handling |
| --- | --- |
| `select=col,col,col` | Project to the listed columns |
| `select=*, foo(a,b)` embeds | Resolve foreign-table via FK convention in Dexie, project columns |
| `select=*, alias:table!fk(...)` aliased embeds | Same, honoring the alias key |
| `select=..., inner!table(...)` inner joins | Filter out rows whose embed is null/soft-deleted |
| Filters `eq / neq / gt / gte / lt / lte / like / ilike / in / is / not.*` | Applied in-memory over the Dexie table |
| `order=col.asc,col2.desc` | Multi-key sort |
| `limit`, `offset`, `Range` header | Applied after filter+sort |
| `.single()` / `.maybeSingle()` (`Accept: pgrst.object+json`) | Return single object, PGRST116 on empty for `single` |
| `Prefer: count=exact` + `head: true` | HEAD-shaped response with `Content-Range` |
| Soft-delete columns (`deleted_at`) | Passed through — page filters still apply |

Unknown/unhandled query shapes fall back to the network so no page silently breaks. Every served response carries `x-local-first: 1` so it's visible in DevTools.

### Layer 2 — Named Repository facade

`src/lib/local-repo.ts` grows into the single documented repository the user's architecture requires:

```text
React Page → Repo → Data Engine → IndexedDB → Background Sync → Cloud
```

New exports (all read-only, all synchronous-feeling, all from Dexie):
- `productsRepo.list / get / search / byCategory`
- `categoriesRepo.list / withCounts`
- `customersRepo.list / get / withBalances`
- `suppliersRepo.list / get / withBalances`
- `purchasesRepo.list / get / withItems`
- `expensesRepo.list / byCategory / pending`
- `cashMovementsRepo.list / cashOnHand / onlineBalance`
- `salesRepo.list / get / byBusinessDate / pending / katha`
- `recipesRepo.list / forProduct`
- `stockRepo.products / items / lowStock`
- `stockTransfersRepo.list / recent`
- `settingsRepo.get / businessConfig`

Route files are updated **incrementally**, one file per edit, to import from the repo. UI is untouched. Because Layer 1 already makes reads local, the incremental migration is cosmetic-not-functional — it lets the codebase honor the architecture requirement without a Big-Bang risk.

## What Ships In This Turn

1. GET interceptor implementation and hook-up (Layer 1 — full effect immediately).
2. Named repository facades added to `src/lib/local-repo.ts` (Layer 2 surface).
3. **First wave** of route conversions to use the repo (highest-value: `dashboard`, `pos`, `products`, `sales`, `reports` engine already uses repo).
4. Post-migration audit script/output listing every remaining direct cloud read.

Subsequent turns can migrate the remaining routes one at a time on top of Layer 1 (which already prevents any runtime cloud reads).

## Guarantees

- Zero runtime cloud reads during normal operation the moment Layer 1 lands.
- Writes stay local-first (existing behavior, unchanged).
- Cloud sync remains background-only.
- No UI changes.
- Reports/Dashboard/POS update instantly after any local mutation (already the case; verified against interceptor + Dexie live queries).
- Offline == online for user experience.

## Technical Notes

- Embeds resolved via a small FK map (`sale_items.product_id → products`, `purchase_items.purchase_id → purchases`, `recipes.parent_product_id → products`, `recipes.component_product_id → products`, `recipes.component_stock_item_id → stock_items`). Unknown embeds return `null` for that column and log a one-time warning.
- `Range: 0-999` header is honored; supabase-js uses it for `.range()` pagination.
- `single/maybeSingle` return the raw object (not array) with correct 406/PGRST116 semantics.
- Count queries (`{ count: "exact", head: true }`) return an empty body with `Content-Range: 0-*/N`.
- Interceptor stays fully transparent: any PostgREST feature not implemented (fts, rpc-in-select, `or=`) falls through to the network so we degrade rather than corrupt.

Approve and I'll implement.
