
-- 1. Add link column on stock_purchases
ALTER TABLE public.stock_purchases
  ADD COLUMN IF NOT EXISTS purchase_item_id uuid REFERENCES public.purchase_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_purchases_purchase_item ON public.stock_purchases(purchase_item_id);

-- 2. Stock adjustment on stock_purchases INSERT/UPDATE/DELETE (delta-based)
CREATE OR REPLACE FUNCTION public.fn_purchase_update_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_qty numeric := 0;
  v_new_qty numeric := 0;
  v_old_pid uuid;
  v_new_pid uuid;
  v_old_sid uuid;
  v_new_sid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    IF NEW.product_id IS NOT NULL THEN
      UPDATE public.products SET current_stock = COALESCE(current_stock,0) + NEW.quantity WHERE id = NEW.product_id;
    ELSIF NEW.stock_item_id IS NOT NULL THEN
      UPDATE public.stock_items SET current_stock = COALESCE(current_stock,0) + NEW.quantity, updated_at = now() WHERE id = NEW.stock_item_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_old_qty := CASE WHEN OLD.deleted_at IS NULL THEN COALESCE(OLD.quantity,0) ELSE 0 END;
    v_new_qty := CASE WHEN NEW.deleted_at IS NULL THEN COALESCE(NEW.quantity,0) ELSE 0 END;
    v_old_pid := OLD.product_id; v_new_pid := NEW.product_id;
    v_old_sid := OLD.stock_item_id; v_new_sid := NEW.stock_item_id;

    -- If target changed (product/stock_item swap), fully reverse old then apply new
    IF v_old_pid IS DISTINCT FROM v_new_pid OR v_old_sid IS DISTINCT FROM v_new_sid THEN
      IF v_old_pid IS NOT NULL AND v_old_qty <> 0 THEN
        UPDATE public.products SET current_stock = COALESCE(current_stock,0) - v_old_qty WHERE id = v_old_pid;
      ELSIF v_old_sid IS NOT NULL AND v_old_qty <> 0 THEN
        UPDATE public.stock_items SET current_stock = COALESCE(current_stock,0) - v_old_qty, updated_at = now() WHERE id = v_old_sid;
      END IF;
      IF v_new_pid IS NOT NULL AND v_new_qty <> 0 THEN
        UPDATE public.products SET current_stock = COALESCE(current_stock,0) + v_new_qty WHERE id = v_new_pid;
      ELSIF v_new_sid IS NOT NULL AND v_new_qty <> 0 THEN
        UPDATE public.stock_items SET current_stock = COALESCE(current_stock,0) + v_new_qty, updated_at = now() WHERE id = v_new_sid;
      END IF;
    ELSE
      -- Same target: apply delta only (covers quantity change, soft-delete, restore; price-only edits produce 0 delta)
      IF v_new_qty - v_old_qty <> 0 THEN
        IF v_new_pid IS NOT NULL THEN
          UPDATE public.products SET current_stock = COALESCE(current_stock,0) + (v_new_qty - v_old_qty) WHERE id = v_new_pid;
        ELSIF v_new_sid IS NOT NULL THEN
          UPDATE public.stock_items SET current_stock = COALESCE(current_stock,0) + (v_new_qty - v_old_qty), updated_at = now() WHERE id = v_new_sid;
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NOT NULL THEN RETURN OLD; END IF;
    IF OLD.product_id IS NOT NULL THEN
      UPDATE public.products SET current_stock = COALESCE(current_stock,0) - COALESCE(OLD.quantity,0) WHERE id = OLD.product_id;
    ELSIF OLD.stock_item_id IS NOT NULL THEN
      UPDATE public.stock_items SET current_stock = COALESCE(current_stock,0) - COALESCE(OLD.quantity,0), updated_at = now() WHERE id = OLD.stock_item_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- Recreate trigger for full INSERT/UPDATE/DELETE coverage
DROP TRIGGER IF EXISTS trg_purchase_update_stock ON public.stock_purchases;
CREATE TRIGGER trg_purchase_update_stock
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_purchases
  FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_update_stock();

-- 3. Link purchase_items ↔ stock_purchases and reverse exact row on delete
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
    -- Prefer link; fall back to best-effort match for legacy rows
    DELETE FROM public.stock_purchases sp
      WHERE sp.purchase_item_id = OLD.id;
    IF NOT FOUND THEN
      DELETE FROM public.stock_purchases sp
      WHERE sp.deleted_at IS NULL
        AND sp.purchase_item_id IS NULL
        AND sp.date = (SELECT date FROM public.purchases WHERE id = OLD.purchase_id)
        AND sp.quantity = OLD.quantity
        AND sp.unit_cost = OLD.unit_cost
        AND COALESCE(sp.product_id::text,'') = COALESCE(OLD.product_id::text,'')
        AND COALESCE(sp.stock_item_id::text,'') = COALESCE(OLD.stock_item_id::text,'');
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $function$;
