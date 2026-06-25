
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Auto-assign first user as admin, others as staff
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count int;
BEGIN
  SELECT count(*) INTO user_count FROM auth.users;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN user_count <= 1 THEN 'admin'::public.app_role ELSE 'staff'::public.app_role END);
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write products" ON public.products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update products" ON public.products FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete products" ON public.products FOR DELETE TO authenticated USING (true);
CREATE INDEX products_name_idx ON public.products (lower(name));

-- Ingredients
CREATE TABLE public.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  unit text NOT NULL,
  minimum_stock numeric(12,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredients TO authenticated;
GRANT ALL ON public.ingredients TO service_role;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all ingredients" ON public.ingredients FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Recipes
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  quantity_required numeric(12,3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, ingredient_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT ALL ON public.recipes TO service_role;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all recipes" ON public.recipes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Stock purchases
CREATE TABLE public.stock_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL,
  unit_cost numeric(12,2) NOT NULL,
  total_cost numeric(14,2) NOT NULL,
  supplier text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_purchases TO authenticated;
GRANT ALL ON public.stock_purchases TO service_role;
ALTER TABLE public.stock_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all purchases" ON public.stock_purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Expenses
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL,
  amount numeric(12,2) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all expenses" ON public.expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Sales
CREATE SEQUENCE public.invoice_seq START 1000;

CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL UNIQUE DEFAULT ('INV-' || nextval('public.invoice_seq')::text),
  sale_date timestamptz NOT NULL DEFAULT now(),
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all sales" ON public.sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL,
  price numeric(12,2) NOT NULL,
  total numeric(14,2) NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all sale_items" ON public.sale_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Ingredient movements (ledger: + purchase, - consumption)
CREATE TYPE public.movement_type AS ENUM ('purchase', 'consumption', 'adjustment');

CREATE TABLE public.ingredient_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  movement_type public.movement_type NOT NULL,
  quantity numeric(14,3) NOT NULL, -- signed: positive purchase, negative consumption
  unit_cost numeric(12,4),
  reference_type text,
  reference_id uuid,
  date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredient_movements TO authenticated;
GRANT ALL ON public.ingredient_movements TO service_role;
ALTER TABLE public.ingredient_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all movements" ON public.ingredient_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX movements_ingredient_date_idx ON public.ingredient_movements (ingredient_id, date);

-- Stock summary view
CREATE OR REPLACE VIEW public.stock_summary AS
SELECT
  i.id AS ingredient_id,
  i.name,
  i.unit,
  i.minimum_stock,
  COALESCE(SUM(CASE WHEN m.movement_type = 'purchase' THEN m.quantity ELSE 0 END), 0)::numeric(14,3) AS purchased,
  COALESCE(SUM(CASE WHEN m.movement_type = 'consumption' THEN -m.quantity ELSE 0 END), 0)::numeric(14,3) AS consumed,
  COALESCE(SUM(m.quantity), 0)::numeric(14,3) AS remaining
FROM public.ingredients i
LEFT JOIN public.ingredient_movements m ON m.ingredient_id = i.id
GROUP BY i.id, i.name, i.unit, i.minimum_stock;
GRANT SELECT ON public.stock_summary TO authenticated;

-- Auto-create movement when stock_purchases row inserted
CREATE OR REPLACE FUNCTION public.fn_purchase_to_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ingredient_movements (ingredient_id, movement_type, quantity, unit_cost, reference_type, reference_id, date)
  VALUES (NEW.ingredient_id, 'purchase', NEW.quantity, NEW.unit_cost, 'stock_purchase', NEW.id, NEW.date);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_purchase_movement
AFTER INSERT ON public.stock_purchases
FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_to_movement();

-- Atomic save sale RPC
CREATE OR REPLACE FUNCTION public.save_sale(_items jsonb)
RETURNS public.sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale public.sales;
  v_item jsonb;
  v_total numeric(14,2) := 0;
  v_product public.products;
  v_recipe RECORD;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;

  INSERT INTO public.sales (grand_total, created_by) VALUES (0, v_uid) RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total)
    VALUES (
      v_sale.id,
      v_product.id,
      (v_item->>'quantity')::numeric,
      v_product.sale_price,
      v_product.sale_price * (v_item->>'quantity')::numeric
    );
    v_total := v_total + v_product.sale_price * (v_item->>'quantity')::numeric;

    -- Deduct ingredients per recipe
    FOR v_recipe IN SELECT ingredient_id, quantity_required FROM public.recipes WHERE product_id = v_product.id LOOP
      INSERT INTO public.ingredient_movements (ingredient_id, movement_type, quantity, reference_type, reference_id)
      VALUES (
        v_recipe.ingredient_id,
        'consumption',
        -(v_recipe.quantity_required * (v_item->>'quantity')::numeric),
        'sale',
        v_sale.id
      );
    END LOOP;
  END LOOP;

  UPDATE public.sales SET grand_total = v_total WHERE id = v_sale.id RETURNING * INTO v_sale;
  RETURN v_sale;
END; $$;
GRANT EXECUTE ON FUNCTION public.save_sale(jsonb) TO authenticated;
