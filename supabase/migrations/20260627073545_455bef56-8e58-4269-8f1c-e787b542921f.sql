
CREATE OR REPLACE FUNCTION public.fn_purchase_sync_category()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT category INTO NEW.category FROM public.products WHERE id = NEW.product_id;
  END IF;
  IF NEW.category IS NULL OR trim(NEW.category) = '' THEN
    NEW.category := 'Snacks';
  END IF;
  RETURN NEW;
END $$;
