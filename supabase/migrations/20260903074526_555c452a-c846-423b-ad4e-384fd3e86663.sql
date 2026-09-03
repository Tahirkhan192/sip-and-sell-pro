ALTER TABLE public.stock_opening_snapshots
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'opening';

DO $x$ BEGIN
  ALTER TABLE public.stock_opening_snapshots
    ADD CONSTRAINT stock_opening_snapshots_kind_check CHECK (kind IN ('opening','closing'));
EXCEPTION WHEN duplicate_object THEN NULL; END $x$;

ALTER TABLE public.stock_opening_snapshots
  DROP CONSTRAINT IF EXISTS stock_opening_snapshots_scope_item_id_year_month_key;

DO $x$ BEGIN
  ALTER TABLE public.stock_opening_snapshots
    ADD CONSTRAINT stock_opening_snapshots_unique_key UNIQUE (scope, item_id, year, month, kind);
EXCEPTION WHEN duplicate_object THEN NULL; END $x$;

CREATE OR REPLACE FUNCTION public.lock_month_opening(_year integer, _month integer, _rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_year integer;
  v_prev_month integer;
  v_count integer := 0;
BEGIN
  IF _month < 1 OR _month > 12 THEN RAISE EXCEPTION 'Invalid month'; END IF;
  v_prev_year := CASE WHEN _month = 1 THEN _year - 1 ELSE _year END;
  v_prev_month := CASE WHEN _month = 1 THEN 12 ELSE _month - 1 END;

  -- Opening record for the new month (replaces, never adds)
  INSERT INTO public.stock_opening_snapshots (scope, item_id, year, month, kind, quantity, unit_value)
  SELECT r.scope, r.item_id, _year, _month, 'opening', r.quantity, r.unit_value
  FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
  WHERE r.scope IN ('product','stock_item') AND r.item_id IS NOT NULL
  ON CONFLICT (scope, item_id, year, month, kind)
  DO UPDATE SET quantity = EXCLUDED.quantity, unit_value = EXCLUDED.unit_value, updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Same figures become the previous month's closing record
  INSERT INTO public.stock_opening_snapshots (scope, item_id, year, month, kind, quantity, unit_value)
  SELECT r.scope, r.item_id, v_prev_year, v_prev_month, 'closing', r.quantity, r.unit_value
  FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
  WHERE r.scope IN ('product','stock_item') AND r.item_id IS NOT NULL
  ON CONFLICT (scope, item_id, year, month, kind)
  DO UPDATE SET quantity = EXCLUDED.quantity, unit_value = EXCLUDED.unit_value, updated_at = now();

  -- Keep the live opening_stock column aligned when locking the current month
  IF (_year, _month) = (EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int) THEN
    UPDATE public.products p
      SET opening_stock = r.quantity
      FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
      WHERE r.scope = 'product' AND p.id = r.item_id AND p.deleted_at IS NULL;
    UPDATE public.stock_items s
      SET opening_stock = r.quantity, updated_at = now()
      FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
      WHERE r.scope = 'stock_item' AND s.id = r.item_id AND s.deleted_at IS NULL;
  END IF;

  RETURN v_count;
END $function$;

GRANT EXECUTE ON FUNCTION public.lock_month_opening(integer, integer, jsonb) TO authenticated;