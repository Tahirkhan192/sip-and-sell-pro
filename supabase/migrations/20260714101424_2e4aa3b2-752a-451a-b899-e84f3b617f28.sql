
-- =========================================================
-- Multi-item Purchases with Paid/Unpaid + auto cash movement
-- =========================================================

CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Karachi')::date),
  supplier text,
  category text,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid','unpaid')),
  payment_method text CHECK (payment_method IN ('cash','online')),
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  cash_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth can manage purchases" ON public.purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  stock_item_id uuid REFERENCES public.stock_items(id),
  category text,
  quantity numeric(14,3) NOT NULL,
  unit text,
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((product_id IS NOT NULL) <> (stock_item_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON public.purchase_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_stock_item ON public.purchase_items(stock_item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO authenticated;
GRANT ALL ON public.purchase_items TO service_role;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth can manage purchase_items" ON public.purchase_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_purchases_updated_at ON public.purchases;
CREATE TRIGGER trg_purchases_updated_at BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- Trigger: purchase_items maintain stock + WAC and cascade back to stock_purchases
-- We insert one stock_purchases row per purchase_item so existing reports and WAC
-- recompute logic keep working unchanged.
-- =========================================================

CREATE OR REPLACE FUNCTION public.fn_purchase_item_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent public.purchases;
  v_sp_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_parent FROM public.purchases WHERE id = NEW.purchase_id;
    -- Mirror into stock_purchases so WAC + reports pick it up
    INSERT INTO public.stock_purchases (date, product_id, stock_item_id, category, quantity, unit_cost, total_cost, supplier, notes)
    VALUES (v_parent.date, NEW.product_id, NEW.stock_item_id, NEW.category, NEW.quantity, NEW.unit_cost, NEW.total_cost, v_parent.supplier, NULL)
    RETURNING id INTO v_sp_id;
    -- Store link in category column? we don't have one — skip for now; recompute WAC covers it
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Remove mirroring stock_purchase rows (best-effort match)
    DELETE FROM public.stock_purchases sp
    WHERE sp.deleted_at IS NULL
      AND sp.date = (SELECT date FROM public.purchases WHERE id = OLD.purchase_id)
      AND sp.quantity = OLD.quantity
      AND sp.unit_cost = OLD.unit_cost
      AND COALESCE(sp.product_id::text,'') = COALESCE(OLD.product_id::text,'')
      AND COALESCE(sp.stock_item_id::text,'') = COALESCE(OLD.stock_item_id::text,'');
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_item_apply ON public.purchase_items;
CREATE TRIGGER trg_purchase_item_apply
  AFTER INSERT OR DELETE ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_item_apply();

-- =========================================================
-- Auto cash movement on paid purchases
-- =========================================================

CREATE OR REPLACE FUNCTION public.fn_purchase_cash_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
BEGIN
  -- Remove any existing linked movement first
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.cash_movement_id IS NOT NULL THEN
    DELETE FROM public.cash_movements WHERE id = OLD.cash_movement_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.payment_status = 'paid'
     AND NEW.payment_method IN ('cash','online')
     AND NEW.deleted_at IS NULL
     AND NEW.grand_total > 0 THEN
    v_type := CASE WHEN NEW.payment_method = 'cash' THEN 'cash_out' ELSE 'online_out' END;
    INSERT INTO public.cash_movements (date, amount, type, category, description, reference_type, reference_id)
    VALUES (
      NEW.date, NEW.grand_total, v_type, 'Purchase',
      'Purchase' || COALESCE(' — ' || NEW.supplier, ''),
      'purchase', NEW.id
    )
    RETURNING id INTO NEW.cash_movement_id;
  ELSE
    NEW.cash_movement_id := NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_cash_movement ON public.purchases;
CREATE TRIGGER trg_purchase_cash_movement
  BEFORE INSERT OR UPDATE OF payment_status, payment_method, grand_total, deleted_at ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_cash_movement();

DROP TRIGGER IF EXISTS trg_purchase_cash_movement_del ON public.purchases;
CREATE TRIGGER trg_purchase_cash_movement_del
  AFTER DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_cash_movement();
