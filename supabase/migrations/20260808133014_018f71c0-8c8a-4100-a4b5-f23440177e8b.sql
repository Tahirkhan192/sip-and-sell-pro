CREATE OR REPLACE FUNCTION public.fn_purchase_item_apply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent public.purchases;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_parent FROM public.purchases WHERE id = NEW.purchase_id;
    INSERT INTO public.stock_purchases (date, product_id, stock_item_id, category, quantity, unit_cost, total_cost, supplier, notes, purchase_item_id)
    VALUES (v_parent.date, NEW.product_id, NEW.stock_item_id, NEW.category, NEW.quantity, NEW.unit_cost, NEW.total_cost, v_parent.supplier, NULL, NEW.id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only ever remove the ledger row owned by this exact purchase line.
    DELETE FROM public.stock_purchases sp WHERE sp.purchase_item_id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $function$;