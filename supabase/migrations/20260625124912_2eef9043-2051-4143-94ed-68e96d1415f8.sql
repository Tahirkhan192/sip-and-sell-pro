
ALTER FUNCTION public.save_sale(jsonb, text, text) SECURITY INVOKER;
ALTER FUNCTION public.update_pending_sale(uuid, jsonb, text, text) SECURITY INVOKER;
