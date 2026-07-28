
-- 1) Purchase-generated Money Movement now uses real save time (fixes 05:00 AM bug)
CREATE OR REPLACE FUNCTION public.fn_purchase_cash_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamptz := now();
BEGIN
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
    INSERT INTO public.cash_movements (
      business_date, occurred_at, type, payment_source, amount,
      movement_category, notes, reason, reference_type, reference_id
    )
    VALUES (
      business_date_of(_now),
      _now,
      'cash_out',
      NEW.payment_method,
      NEW.grand_total,
      'Purchase',
      COALESCE(NEW.notes, 'Purchase' || COALESCE(' — ' || NEW.supplier, '')),
      'Purchase' || COALESCE(' — ' || NEW.supplier, ''),
      'purchase',
      NEW.id
    )
    RETURNING id INTO NEW.cash_movement_id;
  ELSE
    NEW.cash_movement_id := NULL;
  END IF;

  RETURN NEW;
END $function$;

-- 2) Cascade Money Movement cleanup when a Sale is soft-deleted or hard-deleted
CREATE OR REPLACE FUNCTION public.fn_sale_cash_movement_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.cash_movements
       SET deleted_at = now()
     WHERE reference_type = 'sale'
       AND reference_id = OLD.id
       AND deleted_at IS NULL;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.deleted_at IS NOT NULL
     AND OLD.deleted_at IS NULL THEN
    UPDATE public.cash_movements
       SET deleted_at = now()
     WHERE reference_type = 'sale'
       AND reference_id = NEW.id
       AND deleted_at IS NULL;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sale_cash_movement_cleanup_upd ON public.sales;
CREATE TRIGGER trg_sale_cash_movement_cleanup_upd
AFTER UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.fn_sale_cash_movement_cleanup();

DROP TRIGGER IF EXISTS trg_sale_cash_movement_cleanup_del ON public.sales;
CREATE TRIGGER trg_sale_cash_movement_cleanup_del
AFTER DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.fn_sale_cash_movement_cleanup();
