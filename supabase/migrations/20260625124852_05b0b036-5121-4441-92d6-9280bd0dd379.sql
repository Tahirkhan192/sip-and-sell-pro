
-- 1) Recreate view with SECURITY INVOKER
DROP VIEW IF EXISTS public.stock_summary;
CREATE VIEW public.stock_summary
WITH (security_invoker = true) AS
SELECT i.id AS ingredient_id,
       i.name,
       i.unit,
       i.minimum_stock,
       (COALESCE(sum(CASE WHEN m.movement_type = 'purchase'::movement_type THEN m.quantity ELSE 0 END), 0))::numeric(14,3) AS purchased,
       (COALESCE(sum(CASE WHEN m.movement_type = 'consumption'::movement_type THEN -m.quantity ELSE 0 END), 0))::numeric(14,3) AS consumed,
       (COALESCE(sum(m.quantity), 0))::numeric(14,3) AS remaining
FROM public.ingredients i
LEFT JOIN public.ingredient_movements m ON m.ingredient_id = i.id
GROUP BY i.id, i.name, i.unit, i.minimum_stock;

GRANT SELECT ON public.stock_summary TO authenticated;

-- 2) Drop legacy save_sale overload
DROP FUNCTION IF EXISTS public.save_sale(jsonb);

-- 3) Lock down EXECUTE on SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_sale(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_sale(jsonb, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_pending_sale(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pending_sale(uuid, jsonb, text, text) TO authenticated, service_role;

-- Trigger functions: only the trigger machinery needs to call them
REVOKE ALL ON FUNCTION public.handle_new_user_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_purchase_to_movement() FROM PUBLIC, anon, authenticated;

-- 4) Replace permissive (USING true / CHECK true) policies with signed-in checks
DROP POLICY IF EXISTS "auth all expenses" ON public.expenses;
CREATE POLICY "auth all expenses" ON public.expenses FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth all movements" ON public.ingredient_movements;
CREATE POLICY "auth all movements" ON public.ingredient_movements FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth all ingredients" ON public.ingredients;
CREATE POLICY "auth all ingredients" ON public.ingredients FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth write products" ON public.products;
DROP POLICY IF EXISTS "auth update products" ON public.products;
DROP POLICY IF EXISTS "auth delete products" ON public.products;
CREATE POLICY "auth write products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update products" ON public.products FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth delete products" ON public.products FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth all recipes" ON public.recipes;
CREATE POLICY "auth all recipes" ON public.recipes FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth all sale_items" ON public.sale_items;
CREATE POLICY "auth all sale_items" ON public.sale_items FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth all sales" ON public.sales;
CREATE POLICY "auth all sales" ON public.sales FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth all purchases" ON public.stock_purchases;
CREATE POLICY "auth all purchases" ON public.stock_purchases FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
