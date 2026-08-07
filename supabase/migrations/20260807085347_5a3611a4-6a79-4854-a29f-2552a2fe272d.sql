CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('product','stock_item')),
  product_id uuid references public.products(id),
  stock_item_id uuid references public.stock_items(id),
  quantity numeric not null,
  reason text,
  notes text,
  date date not null default (now() at time zone 'Asia/Karachi')::date,
  created_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage stock adjustments" ON public.stock_adjustments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS stock_adjustments_date_idx ON public.stock_adjustments(date);