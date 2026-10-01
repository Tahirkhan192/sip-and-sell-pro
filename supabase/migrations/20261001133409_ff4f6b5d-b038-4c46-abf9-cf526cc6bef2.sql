CREATE OR REPLACE FUNCTION public.lock_month_opening(_year integer, _month integer, _rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_prev_year integer; v_prev_month integer; v_count integer := 0;
BEGIN
  IF _month < 1 OR _month > 12 THEN RAISE EXCEPTION 'Invalid month'; END IF;
  v_prev_year := CASE WHEN _month = 1 THEN _year - 1 ELSE _year END;
  v_prev_month := CASE WHEN _month = 1 THEN 12 ELSE _month - 1 END;
  INSERT INTO public.stock_opening_snapshots (scope, item_id, year, month, kind, quantity, unit_value)
  SELECT r.scope, r.item_id, _year, _month, 'opening', r.quantity, r.unit_value
  FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
  WHERE r.scope IN ('product','stock_item') AND r.item_id IS NOT NULL
  ON CONFLICT (scope, item_id, year, month, kind)
  DO UPDATE SET quantity = EXCLUDED.quantity, unit_value = EXCLUDED.unit_value, updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.stock_opening_snapshots (scope, item_id, year, month, kind, quantity, unit_value)
  SELECT r.scope, r.item_id, v_prev_year, v_prev_month, 'closing', r.quantity, r.unit_value
  FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
  WHERE r.scope IN ('product','stock_item') AND r.item_id IS NOT NULL
  ON CONFLICT (scope, item_id, year, month, kind)
  DO UPDATE SET quantity = EXCLUDED.quantity, unit_value = EXCLUDED.unit_value, updated_at = now();
  RETURN v_count;
END $function$;