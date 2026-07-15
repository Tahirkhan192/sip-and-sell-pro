CREATE OR REPLACE FUNCTION public.fn_purchase_cash_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    INSERT INTO public.cash_movements (
      business_date, occurred_at, type, payment_source, amount,
      movement_category, notes, reason, reference_type, reference_id
    )
    VALUES (
      COALESCE(NEW.date, business_date_of(now())),
      COALESCE((NEW.date)::timestamptz, now()),
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