
-- 1. Add track_stock to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;

-- 2. WhatsApp + general settings columns
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_token text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_phone_id text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_business_id text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_country_code text DEFAULT '92';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_auto_send boolean DEFAULT true;

-- 3. WhatsApp delivery log columns on sales
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS whatsapp_status text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;

-- 4. Update stock helper to respect track_stock on the parent product
CREATE OR REPLACE FUNCTION public.apply_stock_for_sale_item(_product_id uuid, _quantity numeric, _sign integer)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_has_recipe boolean;
  v_track boolean;
  v_allow_neg boolean;
  v_comp RECORD;
  v_new_stock numeric;
  v_product_name text;
BEGIN
  SELECT allow_negative_stock INTO v_allow_neg FROM public.settings WHERE id = 1;
  IF v_allow_neg IS NULL THEN v_allow_neg := false; END IF;

  SELECT track_stock, name INTO v_track, v_product_name FROM public.products WHERE id = _product_id;
  IF v_track IS NULL THEN v_track := true; END IF;

  SELECT EXISTS(SELECT 1 FROM public.recipes WHERE parent_product_id = _product_id AND deleted_at IS NULL)
    INTO v_has_recipe;

  IF v_has_recipe THEN
    -- Always reduce recipe components regardless of track_stock
    FOR v_comp IN
      SELECT r.component_product_id AS pid, r.quantity * _quantity AS qty, p.name, p.allow_negative_stock AS p_allow_neg
      FROM public.recipes r JOIN public.products p ON p.id = r.component_product_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
    LOOP
      UPDATE public.products SET current_stock = current_stock - (_sign * v_comp.qty)
        WHERE id = v_comp.pid RETURNING current_stock INTO v_new_stock;
      IF _sign > 0 AND v_new_stock < 0 AND NOT v_allow_neg AND NOT v_comp.p_allow_neg THEN
        RAISE EXCEPTION 'Insufficient stock for %', v_comp.name;
      END IF;
      UPDATE public.stock_items
        SET current_stock = current_stock - (_sign * v_comp.qty), updated_at = now()
        WHERE lower(trim(name)) = lower(trim(v_comp.name)) AND deleted_at IS NULL;
    END LOOP;
  ELSIF v_track THEN
    UPDATE public.products SET current_stock = current_stock - (_sign * _quantity)
      WHERE id = _product_id RETURNING current_stock INTO v_new_stock;
    IF _sign > 0 AND v_new_stock < 0 AND NOT v_allow_neg THEN
      PERFORM 1 FROM public.products WHERE id = _product_id AND allow_negative_stock = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for %', v_product_name;
      END IF;
    END IF;
    UPDATE public.stock_items
      SET current_stock = current_stock - (_sign * _quantity), updated_at = now()
      WHERE lower(trim(v_product_name)) = lower(trim(name)) AND deleted_at IS NULL;
  END IF;
END $function$;

-- 5. RPC to edit payment / customer / katha of a completed sale (no item change)
CREATE OR REPLACE FUNCTION public.update_sale_payment(
  _sale_id uuid,
  _customer_name text DEFAULT NULL,
  _customer_phone text DEFAULT NULL,
  _cash_paid numeric DEFAULT 0,
  _online_paid numeric DEFAULT 0,
  _katha boolean DEFAULT false
) RETURNS public.sales LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_sale public.sales;
  v_old_remaining numeric;
  v_new_remaining numeric;
  v_customer_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id AND deleted_at IS NULL;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;

  v_old_remaining := GREATEST(v_sale.grand_total - COALESCE(v_sale.cash_paid,0) - COALESCE(v_sale.online_paid,0), 0);

  IF NULLIF(trim(_customer_phone),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers
      WHERE phone = trim(_customer_phone) AND deleted_at IS NULL LIMIT 1;
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (name, phone) VALUES (COALESCE(NULLIF(trim(_customer_name),''),'Guest'), trim(_customer_phone))
        RETURNING id INTO v_customer_id;
    ELSE
      UPDATE public.customers SET name = COALESCE(NULLIF(trim(_customer_name),''), name) WHERE id = v_customer_id;
    END IF;
  END IF;

  UPDATE public.sales SET
    customer_name = NULLIF(trim(_customer_name),''),
    customer_phone = NULLIF(trim(_customer_phone),''),
    customer_id = COALESCE(v_customer_id, customer_id),
    cash_paid = COALESCE(_cash_paid,0),
    online_paid = COALESCE(_online_paid,0),
    katha = COALESCE(_katha,false)
  WHERE id = _sale_id RETURNING * INTO v_sale;

  v_new_remaining := GREATEST(v_sale.grand_total - COALESCE(v_sale.cash_paid,0) - COALESCE(v_sale.online_paid,0), 0);

  -- Adjust customer outstanding balance based on katha delta
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE public.customers SET outstanding_balance = GREATEST(
      outstanding_balance
        - (CASE WHEN v_sale.katha THEN 0 ELSE 0 END)  -- placeholder
        - v_old_remaining
        + (CASE WHEN COALESCE(_katha,false) THEN v_new_remaining ELSE 0 END), 0)
    WHERE id = v_sale.customer_id;
  END IF;

  RETURN v_sale;
END $$;

-- 6. RPC: mark whatsapp status on a sale
CREATE OR REPLACE FUNCTION public.mark_whatsapp_status(_sale_id uuid, _status text)
RETURNS void LANGUAGE sql SET search_path TO 'public' AS $$
  UPDATE public.sales SET whatsapp_status = _status, whatsapp_sent_at = now() WHERE id = _sale_id;
$$;
