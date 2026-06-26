
-- ============== DROP recipe / ingredient stack ==============
DROP VIEW IF EXISTS public.stock_summary CASCADE;
DROP TRIGGER IF EXISTS trg_purchase_movement ON public.stock_purchases;
DROP FUNCTION IF EXISTS public.fn_purchase_to_movement() CASCADE;
DROP FUNCTION IF EXISTS public.save_sale(jsonb, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.update_pending_sale(uuid, jsonb, text, text) CASCADE;
DROP TABLE IF EXISTS public.ingredient_movements CASCADE;
DROP TABLE IF EXISTS public.recipes CASCADE;
DROP TABLE IF EXISTS public.stock_purchases CASCADE;
DROP TABLE IF EXISTS public.ingredients CASCADE;

-- ============== PRODUCTS: add stock + soft delete ==============
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS opening_stock numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_stock numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minimum_stock numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ============== SALES: delivery + payment + soft delete ==============
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS delivery_charges numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_payment_method_check CHECK (payment_method IN ('cash','card'));

-- ============== EXPENSES: soft delete ==============
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ============== STOCK PURCHASES (rebuilt, references products) ==============
CREATE TABLE public.stock_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  stock_item_id uuid,
  quantity numeric(12,3) NOT NULL,
  unit_cost numeric(12,2) NOT NULL,
  total_cost numeric(14,2) NOT NULL,
  supplier text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((product_id IS NOT NULL) <> (stock_item_id IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_purchases TO authenticated;
GRANT ALL ON public.stock_purchases TO service_role;
ALTER TABLE public.stock_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all purchases" ON public.stock_purchases TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ============== STOCK ITEMS (name-matched non-product stock) ==============
CREATE TABLE public.stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs',
  opening_stock numeric(12,3) NOT NULL DEFAULT 0,
  current_stock numeric(12,3) NOT NULL DEFAULT 0,
  minimum_stock numeric(12,3) NOT NULL DEFAULT 0,
  purchase_price numeric(12,2) NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_items_name_uniq ON public.stock_items (lower(trim(name))) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_items TO authenticated;
GRANT ALL ON public.stock_items TO service_role;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all stock_items" ON public.stock_items TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Add FK from stock_purchases to stock_items now that table exists
ALTER TABLE public.stock_purchases
  ADD CONSTRAINT stock_purchases_stock_item_fk FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE RESTRICT;

-- Trigger: increment current_stock on purchase insert
CREATE OR REPLACE FUNCTION public.fn_purchase_update_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE public.products SET current_stock = current_stock + NEW.quantity WHERE id = NEW.product_id;
  ELSIF NEW.stock_item_id IS NOT NULL THEN
    UPDATE public.stock_items SET current_stock = current_stock + NEW.quantity, updated_at = now() WHERE id = NEW.stock_item_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_purchase_update_stock AFTER INSERT ON public.stock_purchases
  FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_update_stock();

-- ============== MONTHLY STOCK OVERRIDES ==============
CREATE TABLE public.monthly_stock_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('product','stock_item','category')),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  stock_item_id uuid REFERENCES public.stock_items(id) ON DELETE CASCADE,
  category text,
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  opening_value numeric(14,2),
  closing_value numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX msoverr_uniq_prod ON public.monthly_stock_overrides (product_id, year, month) WHERE scope='product';
CREATE UNIQUE INDEX msoverr_uniq_item ON public.monthly_stock_overrides (stock_item_id, year, month) WHERE scope='stock_item';
CREATE UNIQUE INDEX msoverr_uniq_cat  ON public.monthly_stock_overrides (category, year, month) WHERE scope='category';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_stock_overrides TO authenticated;
GRANT ALL ON public.monthly_stock_overrides TO service_role;
ALTER TABLE public.monthly_stock_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all overrides" ON public.monthly_stock_overrides TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ============== DELIVERY EXPENSES ==============
CREATE TABLE public.delivery_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  fuel_cost numeric(12,2) NOT NULL DEFAULT 0,
  maintenance_cost numeric(12,2) NOT NULL DEFAULT 0,
  description text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_expenses TO authenticated;
GRANT ALL ON public.delivery_expenses TO service_role;
ALTER TABLE public.delivery_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all delivery_expenses" ON public.delivery_expenses TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ============== FUTURE-READY STUBS ==============
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  address text,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all customers" ON public.customers TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  address text,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all suppliers" ON public.suppliers TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all branches" ON public.branches TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text,
  phone text,
  salary numeric(12,2) NOT NULL DEFAULT 0,
  joined_on date,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all employees" ON public.employees TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read audit" ON public.audit_log FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth insert audit" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- ============== RPCS ==============
-- save_sale: deducts stock by exact name match (lower+trim) against products, then stock_items.
CREATE OR REPLACE FUNCTION public.save_sale(
  _items jsonb,
  _customer_name text DEFAULT NULL,
  _status text DEFAULT 'completed',
  _delivery_charges numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash'
) RETURNS public.sales
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_sale public.sales;
  v_item jsonb;
  v_subtotal numeric(14,2) := 0;
  v_product public.products;
  v_uid uuid := auth.uid();
  v_match_rows int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;

  INSERT INTO public.sales (grand_total, created_by, customer_name, status, delivery_charges, payment_method)
  VALUES (0, v_uid, NULLIF(trim(_customer_name), ''), _status, COALESCE(_delivery_charges,0), _payment_method)
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND deleted_at IS NULL;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total)
    VALUES (v_sale.id, v_product.id, (v_item->>'quantity')::numeric, v_product.sale_price,
            v_product.sale_price * (v_item->>'quantity')::numeric);
    v_subtotal := v_subtotal + v_product.sale_price * (v_item->>'quantity')::numeric;

    IF _status = 'completed' THEN
      -- Decrement own product's current_stock
      UPDATE public.products
        SET current_stock = current_stock - (v_item->>'quantity')::numeric
        WHERE id = v_product.id;
      -- Also decrement any stock_item with matching name (name-based deduction)
      UPDATE public.stock_items
        SET current_stock = current_stock - (v_item->>'quantity')::numeric, updated_at = now()
        WHERE lower(trim(name)) = lower(trim(v_product.name)) AND deleted_at IS NULL;
    END IF;
  END LOOP;

  UPDATE public.sales
    SET grand_total = v_subtotal + COALESCE(_delivery_charges,0)
    WHERE id = v_sale.id
    RETURNING * INTO v_sale;
  RETURN v_sale;
END $$;

-- update_pending_sale: replace items + delivery + payment
CREATE OR REPLACE FUNCTION public.update_pending_sale(
  _sale_id uuid,
  _items jsonb,
  _customer_name text DEFAULT NULL,
  _status text DEFAULT 'pending',
  _delivery_charges numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash'
) RETURNS public.sales
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_sale public.sales;
  v_item jsonb;
  v_subtotal numeric(14,2) := 0;
  v_product public.products;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status <> 'pending' THEN RAISE EXCEPTION 'Only pending sales can be edited'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;

  DELETE FROM public.sale_items WHERE sale_id = _sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND deleted_at IS NULL;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total)
    VALUES (_sale_id, v_product.id, (v_item->>'quantity')::numeric, v_product.sale_price,
            v_product.sale_price * (v_item->>'quantity')::numeric);
    v_subtotal := v_subtotal + v_product.sale_price * (v_item->>'quantity')::numeric;

    IF _status = 'completed' THEN
      UPDATE public.products SET current_stock = current_stock - (v_item->>'quantity')::numeric WHERE id = v_product.id;
      UPDATE public.stock_items
        SET current_stock = current_stock - (v_item->>'quantity')::numeric, updated_at = now()
        WHERE lower(trim(name)) = lower(trim(v_product.name)) AND deleted_at IS NULL;
    END IF;
  END LOOP;

  UPDATE public.sales
  SET grand_total = v_subtotal + COALESCE(_delivery_charges,0),
      customer_name = NULLIF(trim(_customer_name), ''),
      status = _status,
      delivery_charges = COALESCE(_delivery_charges,0),
      payment_method = _payment_method
  WHERE id = _sale_id
  RETURNING * INTO v_sale;
  RETURN v_sale;
END $$;

-- restore_sale_stock: re-increment stock for a completed sale (used before delete)
CREATE OR REPLACE FUNCTION public.restore_sale_stock(_sale_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_sale public.sales;
  v_item RECORD;
  v_pname text;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF v_sale IS NULL OR v_sale.status <> 'completed' THEN RETURN; END IF;
  FOR v_item IN SELECT si.product_id, si.quantity, p.name FROM public.sale_items si JOIN public.products p ON p.id = si.product_id WHERE si.sale_id = _sale_id LOOP
    UPDATE public.products SET current_stock = current_stock + v_item.quantity WHERE id = v_item.product_id;
    UPDATE public.stock_items SET current_stock = current_stock + v_item.quantity, updated_at = now()
      WHERE lower(trim(name)) = lower(trim(v_item.name)) AND deleted_at IS NULL;
  END LOOP;
END $$;
