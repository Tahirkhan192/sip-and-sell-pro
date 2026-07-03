
-- 1) Dynamic expense categories
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories TO authenticated;
GRANT ALL ON public.expense_categories TO service_role;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth manage expense_categories" ON public.expense_categories;
CREATE POLICY "auth manage expense_categories" ON public.expense_categories
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

INSERT INTO public.expense_categories (name, sort_order) VALUES
  ('Staff Salary',1),('Food',2),('Rent',3),('Electricity',4),('Gas',5),
  ('Internet',6),('Fuel',7),('Maintenance',8),('Cleaning',9),
  ('Office Supplies',10),('Marketing',11),('Miscellaneous',99)
ON CONFLICT (name) DO NOTHING;

-- 2) Weighted-Average Cost recalculation on purchase changes
CREATE OR REPLACE FUNCTION public.recompute_product_wac(_product_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_qty numeric; v_amt numeric;
BEGIN
  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(total_cost),0)
    INTO v_qty, v_amt
    FROM public.stock_purchases
    WHERE product_id = _product_id AND deleted_at IS NULL;
  IF v_qty > 0 THEN
    UPDATE public.products SET cost_price = round(v_amt / v_qty, 4) WHERE id = _product_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.recompute_stock_item_wac(_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_qty numeric; v_amt numeric;
BEGIN
  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(total_cost),0)
    INTO v_qty, v_amt
    FROM public.stock_purchases
    WHERE stock_item_id = _id AND deleted_at IS NULL;
  IF v_qty > 0 THEN
    UPDATE public.stock_items
      SET purchase_price = round(v_amt / v_qty, 4), updated_at = now()
      WHERE id = _id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_purchase_recalc_wac()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF NEW.product_id IS NOT NULL THEN PERFORM public.recompute_product_wac(NEW.product_id); END IF;
    IF NEW.stock_item_id IS NOT NULL THEN PERFORM public.recompute_stock_item_wac(NEW.stock_item_id); END IF;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF OLD.product_id IS NOT NULL AND (TG_OP='DELETE' OR OLD.product_id IS DISTINCT FROM NEW.product_id) THEN
      PERFORM public.recompute_product_wac(OLD.product_id);
    END IF;
    IF OLD.stock_item_id IS NOT NULL AND (TG_OP='DELETE' OR OLD.stock_item_id IS DISTINCT FROM NEW.stock_item_id) THEN
      PERFORM public.recompute_stock_item_wac(OLD.stock_item_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_purchase_recalc_wac ON public.stock_purchases;
CREATE TRIGGER trg_purchase_recalc_wac
AFTER INSERT OR UPDATE OR DELETE ON public.stock_purchases
FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_recalc_wac();

-- Backfill WAC for all existing purchases
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT product_id FROM public.stock_purchases WHERE product_id IS NOT NULL AND deleted_at IS NULL LOOP
    PERFORM public.recompute_product_wac(r.product_id);
  END LOOP;
  FOR r IN SELECT DISTINCT stock_item_id FROM public.stock_purchases WHERE stock_item_id IS NOT NULL AND deleted_at IS NULL LOOP
    PERFORM public.recompute_stock_item_wac(r.stock_item_id);
  END LOOP;
END $$;

-- 3) Stock transfer now actually reduces available stock
CREATE OR REPLACE FUNCTION public.save_stock_transfer(
  _item_type text, _product_id uuid, _stock_item_id uuid,
  _from_category text, _to_category text, _quantity numeric,
  _reason text DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS public.stock_transfers
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  v_row public.stock_transfers; v_uid uuid := auth.uid();
  v_name text; v_unit text; v_unit_cost numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _item_type NOT IN ('product','stock_item') THEN RAISE EXCEPTION 'Invalid item type'; END IF;
  IF COALESCE(_quantity,0) <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF NULLIF(trim(_from_category),'') IS NULL OR NULLIF(trim(_to_category),'') IS NULL THEN
    RAISE EXCEPTION 'From and To categories are required';
  END IF;
  IF trim(_from_category) = trim(_to_category) THEN RAISE EXCEPTION 'From and To categories must differ'; END IF;

  IF _item_type = 'product' THEN
    SELECT name, unit, COALESCE(cost_price,0) INTO v_name, v_unit, v_unit_cost
      FROM public.products WHERE id=_product_id AND deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
    UPDATE public.products SET current_stock = current_stock - _quantity WHERE id=_product_id;
    UPDATE public.stock_items SET current_stock = current_stock - _quantity, updated_at=now()
      WHERE lower(trim(name)) = lower(trim(v_name)) AND deleted_at IS NULL;
  ELSE
    SELECT name, unit, COALESCE(purchase_price,0) INTO v_name, v_unit, v_unit_cost
      FROM public.stock_items WHERE id=_stock_item_id AND deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Stock item not found'; END IF;
    UPDATE public.stock_items SET current_stock = current_stock - _quantity, updated_at=now()
      WHERE id=_stock_item_id;
  END IF;

  INSERT INTO public.stock_transfers(
    item_type, product_id, stock_item_id, item_name,
    from_category, to_category, quantity, unit, unit_cost, total_cost,
    reason, notes, created_by
  ) VALUES (
    _item_type,
    CASE WHEN _item_type='product' THEN _product_id END,
    CASE WHEN _item_type='stock_item' THEN _stock_item_id END,
    v_name, trim(_from_category), trim(_to_category),
    _quantity, COALESCE(v_unit,'pcs'), v_unit_cost, round(_quantity*v_unit_cost,2),
    NULLIF(trim(_reason),''), NULLIF(trim(_notes),''), v_uid
  ) RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- Restore stock when a transfer is soft-deleted
CREATE OR REPLACE FUNCTION public.fn_stock_transfer_reverse()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NEW.item_type='product' AND NEW.product_id IS NOT NULL THEN
      UPDATE public.products SET current_stock = current_stock + NEW.quantity WHERE id=NEW.product_id;
      UPDATE public.stock_items SET current_stock = current_stock + NEW.quantity, updated_at=now()
        WHERE lower(trim(name)) = lower(trim(NEW.item_name)) AND deleted_at IS NULL;
    ELSIF NEW.item_type='stock_item' AND NEW.stock_item_id IS NOT NULL THEN
      UPDATE public.stock_items SET current_stock = current_stock + NEW.quantity, updated_at=now()
        WHERE id=NEW.stock_item_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stock_transfer_reverse ON public.stock_transfers;
CREATE TRIGGER trg_stock_transfer_reverse
AFTER UPDATE ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.fn_stock_transfer_reverse();

-- 4) Category monthly report: no expense allocation; Net = Sales + Closing - (Opening + Purchases)
CREATE OR REPLACE FUNCTION public.category_monthly_report(_month date)
RETURNS TABLE(
  category text, opening_value numeric, product_purchased_value numeric,
  stock_purchased_value numeric, purchased_value numeric, sales_qty numeric,
  sales_revenue numeric, sales_cogs numeric, closing_value numeric,
  gross_profit numeric, expenses_allocated numeric, net_profit numeric
)
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE
  v_month_start date := date_trunc('month', _month)::date;
  v_month_end date := (date_trunc('month', _month) + interval '1 month')::date;
BEGIN
  RETURN QUERY
  WITH cats AS (SELECT name FROM public.categories WHERE deleted_at IS NULL),
  prod_pur AS (
    SELECT sp.category, SUM(sp.total_cost) AS val FROM public.stock_purchases sp
    WHERE sp.deleted_at IS NULL AND sp.product_id IS NOT NULL
      AND sp.date >= v_month_start AND sp.date < v_month_end
    GROUP BY sp.category
  ),
  stock_pur AS (
    SELECT sp.category, SUM(sp.total_cost) AS val FROM public.stock_purchases sp
    WHERE sp.deleted_at IS NULL AND sp.stock_item_id IS NOT NULL
      AND sp.date >= v_month_start AND sp.date < v_month_end
    GROUP BY sp.category
  ),
  item_costs AS (
    SELECT p.category AS category, si.quantity AS qty, si.total AS revenue,
      CASE WHEN EXISTS(SELECT 1 FROM public.recipes r WHERE r.parent_product_id=p.id AND r.deleted_at IS NULL)
        THEN COALESCE((SELECT SUM(r.quantity*COALESCE(cp.cost_price,0))
          FROM public.recipes r JOIN public.products cp ON cp.id=r.component_product_id
          WHERE r.parent_product_id=p.id AND r.deleted_at IS NULL),0)*si.quantity
        ELSE COALESCE(p.cost_price,0)*si.quantity END AS cogs
    FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id
    JOIN public.products p ON p.id=si.product_id
    WHERE s.deleted_at IS NULL AND s.status='completed'
      AND public.business_date(s.sale_date) >= v_month_start
      AND public.business_date(s.sale_date) <  v_month_end
  ),
  sold AS (SELECT category, SUM(qty) AS qty, SUM(revenue) AS revenue, SUM(cogs) AS cogs
           FROM item_costs GROUP BY category),
  overrides AS (
    SELECT category, opening_value, closing_value
    FROM public.monthly_stock_overrides
    WHERE make_date(year, month, 1) = v_month_start
  ),
  current_stock_val AS (
    SELECT p.category, SUM(COALESCE(p.current_stock,0)*COALESCE(p.cost_price,0)) AS val
    FROM public.products p WHERE p.deleted_at IS NULL GROUP BY p.category
  )
  SELECT
    c.name,
    COALESCE(o.opening_value, 0),
    COALESCE(pp.val,0),
    COALESCE(sp2.val,0),
    COALESCE(pp.val,0) + COALESCE(sp2.val,0),
    COALESCE(sd.qty,0), COALESCE(sd.revenue,0), COALESCE(sd.cogs,0),
    COALESCE(o.closing_value, cs.val, 0),
    COALESCE(sd.revenue,0) - COALESCE(sd.cogs,0),
    0::numeric,
    -- Net Profit = Sales + Closing Stock - (Opening + Purchases)
    COALESCE(sd.revenue,0) + COALESCE(o.closing_value, cs.val, 0)
      - (COALESCE(o.opening_value,0) + COALESCE(pp.val,0) + COALESCE(sp2.val,0))
  FROM cats c
  LEFT JOIN prod_pur pp ON pp.category = c.name
  LEFT JOIN stock_pur sp2 ON sp2.category = c.name
  LEFT JOIN sold sd ON sd.category = c.name
  LEFT JOIN overrides o ON o.category = c.name
  LEFT JOIN current_stock_val cs ON cs.category = c.name
  ORDER BY c.name;
END $$;
