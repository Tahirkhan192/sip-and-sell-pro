CREATE OR REPLACE FUNCTION public.apply_stock_for_sale_item(
  _product_id uuid, _quantity numeric, _sign integer, _order_type text DEFAULT 'walk_in'
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_recipe boolean;
  v_track boolean;
  v_auto boolean;
  v_allow_neg boolean;
  v_comp RECORD;
  v_new_stock numeric;
  v_product_name text;
  v_ot text := COALESCE(_order_type, 'walk_in');
BEGIN
  SELECT allow_negative_stock INTO v_allow_neg FROM public.settings WHERE id = 1;
  IF v_allow_neg IS NULL THEN v_allow_neg := false; END IF;

  SELECT track_stock, auto_calc, name INTO v_track, v_auto, v_product_name
  FROM public.products WHERE id = _product_id;
  IF v_track IS NULL THEN v_track := true; END IF;
  IF v_auto IS NULL THEN v_auto := false; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.recipes
    WHERE parent_product_id = _product_id AND deleted_at IS NULL AND v_ot = ANY(applies_to)
  ) INTO v_has_recipe;

  IF v_has_recipe THEN
    FOR v_comp IN
      SELECT p.id AS pid, r.quantity * _quantity AS qty, p.name,
             p.allow_negative_stock AS p_allow_neg,
             COALESCE(p.track_stock, true) AS p_track,
             COALESCE(p.auto_calc, false) AS p_auto
      FROM public.recipes r
      JOIN public.products p ON p.id = r.component_product_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
        AND r.component_product_id IS NOT NULL
        AND v_ot = ANY(r.applies_to)
    LOOP
      IF NOT v_comp.p_track THEN
        CONTINUE; -- Stock Tracking OFF: unlimited, never deducted or validated
      END IF;
      UPDATE public.products SET current_stock = current_stock - (_sign * v_comp.qty)
        WHERE id = v_comp.pid RETURNING current_stock INTO v_new_stock;
      -- Only a manually maintained item can block a sale; auto items are
      -- rebuilt by the inventory engine, so the stored value is not trusted.
      IF _sign > 0 AND NOT v_comp.p_auto AND v_new_stock < 0
         AND NOT v_allow_neg AND NOT v_comp.p_allow_neg THEN
        RAISE EXCEPTION 'Insufficient stock for %', v_comp.name;
      END IF;
      UPDATE public.stock_items
        SET current_stock = current_stock - (_sign * v_comp.qty), updated_at = now()
        WHERE lower(trim(name)) = lower(trim(v_comp.name)) AND deleted_at IS NULL;
    END LOOP;
    FOR v_comp IN
      SELECT si.id AS sid, r.quantity * _quantity AS qty, si.name
      FROM public.recipes r
      JOIN public.stock_items si ON si.id = r.component_stock_item_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
        AND r.component_stock_item_id IS NOT NULL
        AND v_ot = ANY(r.applies_to)
    LOOP
      UPDATE public.stock_items
        SET current_stock = current_stock - (_sign * v_comp.qty), updated_at = now()
        WHERE id = v_comp.sid;
    END LOOP;
  ELSIF v_track THEN
    UPDATE public.products SET current_stock = current_stock - (_sign * _quantity)
      WHERE id = _product_id RETURNING current_stock INTO v_new_stock;
    IF _sign > 0 AND NOT v_auto AND v_new_stock < 0 AND NOT v_allow_neg THEN
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