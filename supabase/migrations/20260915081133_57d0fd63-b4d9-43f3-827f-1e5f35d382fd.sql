CREATE OR REPLACE FUNCTION public.digi_katha_entries(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cut date;
  v_from date;
  v_res jsonb;
BEGIN
  SELECT as_of_date INTO v_cut FROM public.katha_opening WHERE id = 1;
  v_cut := COALESCE(v_cut, '1900-01-01'::date);
  v_from := GREATEST(COALESCE(_from, v_cut), v_cut);

  SELECT jsonb_build_object(
    'from', v_from,
    'to', _to,
    'cutoff', v_cut,
    'katha_sales', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'date', x->>'label') FROM (
        SELECT jsonb_build_object(
          'id', s.id, 'date', public.business_date_of(s.sale_date),
          'label', s.invoice_no, 'party', COALESCE(NULLIF(s.customer_name,''),'Walk-in'),
          'total', s.grand_total, 'paid', s.cash_paid + s.online_paid,
          'amount', GREATEST(s.grand_total - s.cash_paid - s.online_paid, 0)
        ) AS x
        FROM public.sales s
        WHERE s.deleted_at IS NULL AND NOT s.hidden AND s.status='completed' AND s.katha
          AND s.staff_id IS NULL
          AND public.business_date_of(s.sale_date) BETWEEN v_from AND _to
      ) q
    ), '[]'::jsonb),
    'loan_given', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'date', m.business_date, 'label', COALESCE(NULLIF(m.reason,''), m.subcategory, 'Katha Out'), 'party', m.payment_source, 'amount', m.amount) ORDER BY m.business_date, m.occurred_at)
      FROM public.cash_movements m
      WHERE m.deleted_at IS NULL AND m.katha_category='katha' AND m.type='cash_out' AND m.business_date BETWEEN v_from AND _to
    ), '[]'::jsonb),
    'loan_recovered', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'date', m.business_date, 'label', COALESCE(NULLIF(m.reason,''), m.subcategory, 'Katha In'), 'party', m.payment_source, 'amount', m.amount) ORDER BY m.business_date, m.occurred_at)
      FROM public.cash_movements m
      WHERE m.deleted_at IS NULL AND m.katha_category='katha' AND m.type='cash_in' AND m.business_date BETWEEN v_from AND _to
    ), '[]'::jsonb),
    'purchase_katha', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'date', p.date, 'label', COALESCE(NULLIF(p.category,''),'Purchase'), 'party', COALESCE(NULLIF(p.supplier,''),'—'), 'amount', p.grand_total) ORDER BY p.date, p.created_at)
      FROM public.purchases p
      WHERE p.deleted_at IS NULL AND p.payment_status='katha' AND p.date BETWEEN v_from AND _to
    ), '[]'::jsonb),
    'expense_katha', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'date', e.date, 'label', e.category, 'party', COALESCE(NULLIF(e.description,''), COALESCE(NULLIF(e.supplier,''),'—')), 'amount', e.amount) ORDER BY e.date, e.created_at)
      FROM public.expenses e
      WHERE e.deleted_at IS NULL AND e.payment_status='katha' AND COALESCE(e.is_stock_transfer,false)=false AND e.date BETWEEN v_from AND _to
    ), '[]'::jsonb),
    'delivery_expense_katha', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'date', d.date, 'label', 'Delivery', 'party', COALESCE(NULLIF(d.description,''),'—'), 'amount', COALESCE(d.fuel_cost,0)+COALESCE(d.maintenance_cost,0)) ORDER BY d.date, d.created_at)
      FROM public.delivery_expenses d
      WHERE d.deleted_at IS NULL AND d.payment_status='katha' AND d.date BETWEEN v_from AND _to
    ), '[]'::jsonb),
    'loan_taken', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'date', m.business_date, 'label', COALESCE(NULLIF(m.reason,''), m.subcategory, 'Loan Get In'), 'party', m.payment_source, 'amount', m.amount) ORDER BY m.business_date, m.occurred_at)
      FROM public.cash_movements m
      WHERE m.deleted_at IS NULL AND m.katha_category='loan_get' AND m.type='cash_in' AND m.business_date BETWEEN v_from AND _to
    ), '[]'::jsonb),
    'loan_repaid', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'date', m.business_date, 'label', COALESCE(NULLIF(m.reason,''), m.subcategory, 'Loan Paid Out'), 'party', m.payment_source, 'amount', m.amount) ORDER BY m.business_date, m.occurred_at)
      FROM public.cash_movements m
      WHERE m.deleted_at IS NULL AND m.katha_category='loan_paid' AND m.type='cash_out' AND m.business_date BETWEEN v_from AND _to
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END $function$;

GRANT EXECUTE ON FUNCTION public.digi_katha_entries(date, date) TO authenticated, anon, service_role;