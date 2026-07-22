
-- 1. Reattach missing triggers on purchases pipeline
DROP TRIGGER IF EXISTS trg_purchase_items_apply ON public.purchase_items;
CREATE TRIGGER trg_purchase_items_apply
AFTER INSERT OR DELETE ON public.purchase_items
FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_item_apply();

DROP TRIGGER IF EXISTS trg_stock_purchases_stock ON public.stock_purchases;
CREATE TRIGGER trg_stock_purchases_stock
AFTER INSERT OR UPDATE OR DELETE ON public.stock_purchases
FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_update_stock();

DROP TRIGGER IF EXISTS trg_purchases_cash_movement ON public.purchases;
CREATE TRIGGER trg_purchases_cash_movement
BEFORE INSERT OR UPDATE OR DELETE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_cash_movement();

-- 2. Mark stock-to-expense transfers so they don't hit Daily Closing cash/online
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS is_stock_transfer boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.stock_to_expense_transfer(_product_id uuid, _stock_item_id uuid, _quantity numeric, _expense_category text, _reason text, _notes text, _date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cost numeric := 0;
  v_amount numeric := 0;
  v_expense_id uuid;
  v_desc text;
BEGIN
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;
  IF (_product_id IS NULL AND _stock_item_id IS NULL) OR (_product_id IS NOT NULL AND _stock_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Provide exactly one of product or stock item';
  END IF;
  IF _expense_category IS NULL OR length(trim(_expense_category)) = 0 THEN
    RAISE EXCEPTION 'Expense category required';
  END IF;

  IF _product_id IS NOT NULL THEN
    SELECT COALESCE(cost_price,0) INTO v_cost FROM public.products WHERE id = _product_id;
    v_amount := round(v_cost * _quantity, 2);
    UPDATE public.products
      SET current_stock = COALESCE(current_stock,0) - _quantity
      WHERE id = _product_id;
    SELECT 'Stock transfer: ' || name || ' × ' || _quantity INTO v_desc FROM public.products WHERE id = _product_id;
  ELSE
    SELECT COALESCE(purchase_price,0) INTO v_cost FROM public.stock_items WHERE id = _stock_item_id;
    v_amount := round(v_cost * _quantity, 2);
    UPDATE public.stock_items
      SET current_stock = COALESCE(current_stock,0) - _quantity,
          updated_at = now()
      WHERE id = _stock_item_id;
    SELECT 'Stock transfer: ' || name || ' × ' || _quantity INTO v_desc FROM public.stock_items WHERE id = _stock_item_id;
  END IF;

  -- Inventory consumption: appears in Expense reports & P&L, but NOT as cash/online in Daily Closing.
  INSERT INTO public.expenses (date, category, amount, description, payment_method, payment_status, paid_amount, is_stock_transfer)
  VALUES (
    COALESCE(_date, (now() AT TIME ZONE 'Asia/Karachi')::date),
    _expense_category,
    v_amount,
    COALESCE(NULLIF(_reason,'') || CASE WHEN _notes IS NOT NULL AND length(_notes)>0 THEN ' — ' || _notes ELSE '' END, v_desc),
    NULL,
    'paid',
    v_amount,
    true
  )
  RETURNING id INTO v_expense_id;

  RETURN v_expense_id;
END $function$;

-- 3. Delivery expenses: add payment tracking
ALTER TABLE public.delivery_expenses
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_method text;

-- 4. Update daily_closing_summary: exclude is_stock_transfer, include paid delivery expenses
CREATE OR REPLACE FUNCTION public.daily_closing_summary(_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev public.daily_closings%ROWTYPE;
  v_curr public.daily_closings%ROWTYPE;
  v_opening_cash numeric := 0;
  v_opening_wallet numeric := 0;
  v_cash_sales numeric := 0;
  v_online_sales numeric := 0;
  v_katha numeric := 0;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_online_in numeric := 0;
  v_online_out numeric := 0;
  v_cash_exp numeric := 0;
  v_online_exp numeric := 0;
  v_invoices int := 0;
BEGIN
  SELECT * INTO v_prev FROM public.daily_closings
   WHERE closing_date < _date ORDER BY closing_date DESC LIMIT 1;
  IF FOUND THEN
    v_opening_cash := v_prev.actual_cash;
    v_opening_wallet := v_prev.actual_wallet;
  END IF;

  SELECT
    COALESCE(SUM(cash_paid),0),
    COALESCE(SUM(online_paid),0),
    COALESCE(SUM(CASE WHEN katha THEN GREATEST(grand_total - cash_paid - online_paid, 0) ELSE 0 END),0),
    COUNT(*)
  INTO v_cash_sales, v_online_sales, v_katha, v_invoices
  FROM public.sales
  WHERE deleted_at IS NULL AND status = 'completed'
    AND public.business_date_of(sale_date) = _date;

  SELECT
    COALESCE(SUM(CASE WHEN type='cash_in'  AND COALESCE(payment_source,'cash')='cash'   THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_out' AND COALESCE(payment_source,'cash')='cash'   THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_in'  AND payment_source='online' THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_out' AND payment_source='online' THEN amount END),0)
  INTO v_cash_in, v_cash_out, v_online_in, v_online_out
  FROM public.cash_movements
  WHERE deleted_at IS NULL AND business_date = _date;

  -- General expenses: exclude stock-transfer inventory consumption entirely from cash/online.
  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(payment_method,'')='cash'   AND COALESCE(payment_status,'paid')='paid' AND NOT COALESCE(is_stock_transfer,false) THEN amount END),0),
    COALESCE(SUM(CASE WHEN COALESCE(payment_method,'')='online' AND COALESCE(payment_status,'paid')='paid' AND NOT COALESCE(is_stock_transfer,false) THEN amount END),0)
  INTO v_cash_exp, v_online_exp
  FROM public.expenses
  WHERE deleted_at IS NULL AND date = _date;

  -- Add paid delivery expenses on top
  v_cash_exp := v_cash_exp + COALESCE((
    SELECT SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0))
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND date = _date
      AND payment_status = 'paid' AND payment_method = 'cash'
  ), 0);
  v_online_exp := v_online_exp + COALESCE((
    SELECT SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0))
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND date = _date
      AND payment_status = 'paid' AND payment_method = 'online'
  ), 0);

  SELECT * INTO v_curr FROM public.daily_closings WHERE closing_date = _date;

  RETURN jsonb_build_object(
    'closing_date', _date,
    'opening_cash', v_opening_cash,
    'opening_wallet', v_opening_wallet,
    'cash_sales', v_cash_sales,
    'online_sales', v_online_sales,
    'katha', v_katha,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'online_in', v_online_in,
    'online_out', v_online_out,
    'cash_expenses', v_cash_exp,
    'online_expenses', v_online_exp,
    'invoices', v_invoices,
    'expected_cash',   v_opening_cash   + v_cash_sales   + v_cash_in   - v_cash_out   - v_cash_exp,
    'expected_wallet', v_opening_wallet + v_online_sales + v_online_in - v_online_out - v_online_exp,
    'actual_cash',   CASE WHEN v_curr.id IS NOT NULL THEN v_curr.actual_cash   ELSE NULL END,
    'actual_wallet', CASE WHEN v_curr.id IS NOT NULL THEN v_curr.actual_wallet ELSE NULL END,
    'closed', v_curr.id IS NOT NULL,
    'notes', v_curr.notes
  );
END; $function$;
