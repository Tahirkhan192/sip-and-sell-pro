REVOKE ALL ON FUNCTION public.lock_month_opening(integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_month_opening(integer, integer, jsonb) TO authenticated;