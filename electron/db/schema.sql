CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START WITH 1000 INCREMENT BY 1 MINVALUE 1;
SELECT setval('public.invoice_seq', 10598, true);
-- Auto-generated from the production database. Runs inside PGlite (embedded Postgres).
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth._session (id int PRIMARY KEY, user_id uuid);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT user_id FROM auth._session WHERE id = 1 $fn$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $fn$ SELECT 'authenticated'::text $fn$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $fn$ SELECT email FROM auth.users WHERE id = auth.uid() $fn$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$ SELECT '{}'::jsonb $fn$;
DO $x$ BEGIN CREATE TYPE public.app_role AS ENUM ('admin','staff'); EXCEPTION WHEN duplicate_object THEN NULL; END $x$;
DO $x$ BEGIN CREATE TYPE public.movement_type AS ENUM ('purchase','consumption','adjustment'); EXCEPTION WHEN duplicate_object THEN NULL; END $x$;
CREATE TABLE IF NOT EXISTS public.audit_log ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "user_id" uuid, "action" text NOT NULL, "entity" text, "entity_id" uuid, "details" jsonb, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.branches ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "address" text, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.cash_movements ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "business_date" date DEFAULT business_date_of(now()) NOT NULL, "occurred_at" timestamp with time zone DEFAULT now() NOT NULL, "type" text NOT NULL, "amount" numeric NOT NULL, "reason" text, "notes" text, "user_id" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone, "payment_source" text DEFAULT 'cash'::text NOT NULL, "movement_category" text, "subcategory" text, "reference_type" text, "reference_id" uuid, "katha_category" text DEFAULT 'transaction'::text NOT NULL);
CREATE TABLE IF NOT EXISTS public.categories ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "sort_order" integer DEFAULT 0 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone, "description" text, "color" text, "icon" text, "active" boolean DEFAULT true NOT NULL);
CREATE TABLE IF NOT EXISTS public.customers ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "phone" text, "address" text, "balance" numeric(14,2) DEFAULT 0 NOT NULL, "notes" text, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "last_visit" timestamp with time zone, "total_orders" integer DEFAULT 0 NOT NULL, "total_purchases" numeric(14,2) DEFAULT 0 NOT NULL, "outstanding_balance" numeric(14,2) DEFAULT 0 NOT NULL);
CREATE TABLE IF NOT EXISTS public.daily_closings ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "closing_date" date NOT NULL, "actual_cash" numeric DEFAULT 0 NOT NULL, "actual_wallet" numeric DEFAULT 0 NOT NULL, "notes" text, "closed_at" timestamp with time zone DEFAULT now() NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.delivery_expenses ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "date" date DEFAULT CURRENT_DATE NOT NULL, "fuel_cost" numeric(12,2) DEFAULT 0 NOT NULL, "maintenance_cost" numeric(12,2) DEFAULT 0 NOT NULL, "description" text, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "payment_status" text DEFAULT 'unpaid'::text NOT NULL, "payment_method" text);
CREATE TABLE IF NOT EXISTS public.employees ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "role" text, "phone" text, "salary" numeric(12,2) DEFAULT 0 NOT NULL, "joined_on" date, "active" boolean DEFAULT true NOT NULL, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.expense_categories ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "active" boolean DEFAULT true NOT NULL, "sort_order" integer DEFAULT 0 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.expenses ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "date" date DEFAULT CURRENT_DATE NOT NULL, "category" text NOT NULL, "amount" numeric(12,2) NOT NULL, "description" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone, "payment_method" text DEFAULT 'cash'::text NOT NULL, "payment_status" text DEFAULT 'paid'::text NOT NULL, "paid_amount" numeric(14,2) DEFAULT 0 NOT NULL, "paid_at" timestamp with time zone, "payment_source" text DEFAULT 'cash'::text NOT NULL, "supplier" text, "notes" text, "is_stock_transfer" boolean DEFAULT false NOT NULL, "source_product_id" uuid, "source_stock_item_id" uuid, "source_quantity" numeric(14,3), "source_unit_cost" numeric(14,4));
CREATE TABLE IF NOT EXISTS public.katha_opening ("id" integer DEFAULT 1 NOT NULL, "opening_loan_to_get" numeric(14,2) DEFAULT 0 NOT NULL, "opening_loan_to_give" numeric(14,2) DEFAULT 0 NOT NULL, "as_of_date" date DEFAULT CURRENT_DATE NOT NULL, "note" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.money_movement_subcategories ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "category" text NOT NULL, "name" text NOT NULL, "active" boolean DEFAULT true NOT NULL, "sort_order" integer DEFAULT 0 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.monthly_stock_overrides ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "scope" text NOT NULL, "product_id" uuid, "stock_item_id" uuid, "category" text, "year" integer NOT NULL, "month" integer NOT NULL, "opening_value" numeric(14,2), "closing_value" numeric(14,2), "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.production_batch_items ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "batch_id" uuid NOT NULL, "component_type" text NOT NULL, "component_product_id" uuid, "component_stock_item_id" uuid, "quantity" numeric(12,3) NOT NULL, "unit_cost" numeric(12,4) NOT NULL, "total_cost" numeric(14,2) NOT NULL, "source_category" text, "target_category" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.production_batches ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "product_id" uuid NOT NULL, "quantity" numeric(12,3) NOT NULL, "batch_date" date DEFAULT business_date(now()) NOT NULL, "notes" text, "total_cost" numeric(14,2) DEFAULT 0 NOT NULL, "unit_cost" numeric(12,4) DEFAULT 0 NOT NULL, "target_category" text, "created_by" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.products ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "category" text NOT NULL, "sale_price" numeric(12,2) DEFAULT 0 NOT NULL, "cost_price" numeric(12,2) DEFAULT 0 NOT NULL, "active" boolean DEFAULT true NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "opening_stock" numeric(12,3) DEFAULT 0 NOT NULL, "current_stock" numeric(12,3) DEFAULT 0 NOT NULL, "minimum_stock" numeric(12,3) DEFAULT 0 NOT NULL, "deleted_at" timestamp with time zone, "unit" text DEFAULT 'pcs'::text NOT NULL, "selling_method" text DEFAULT 'fixed'::text NOT NULL, "allow_negative_stock" boolean DEFAULT false NOT NULL, "track_stock" boolean DEFAULT true NOT NULL, "last_sold_at" timestamp with time zone, "avg_price_override" numeric, "auto_calc" boolean DEFAULT false NOT NULL);
CREATE TABLE IF NOT EXISTS public.purchase_items ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "purchase_id" uuid NOT NULL, "product_id" uuid, "stock_item_id" uuid, "category" text, "quantity" numeric(14,3) NOT NULL, "unit" text, "unit_cost" numeric(14,4) DEFAULT 0 NOT NULL, "total_cost" numeric(14,2) DEFAULT 0 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.purchases ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "date" date DEFAULT ((now() AT TIME ZONE 'Asia/Karachi'::text))::date NOT NULL, "supplier" text, "category" text, "payment_status" text DEFAULT 'unpaid'::text NOT NULL, "payment_method" text, "grand_total" numeric(14,2) DEFAULT 0 NOT NULL, "notes" text, "created_by" uuid, "cash_movement_id" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.recipes ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "parent_product_id" uuid NOT NULL, "component_product_id" uuid, "quantity" numeric(12,3) NOT NULL, "unit" text DEFAULT 'pcs'::text NOT NULL, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "component_stock_item_id" uuid, "applies_to" text[] DEFAULT ARRAY['walk_in'::text, 'take_away'::text, 'delivery'::text] NOT NULL);
CREATE TABLE IF NOT EXISTS public.sale_items ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "sale_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" numeric(12,3) NOT NULL, "price" numeric(12,2) NOT NULL, "total" numeric(14,2) NOT NULL, "unit" text);
CREATE UNIQUE INDEX IF NOT EXISTS sale_items_sale_product_key ON public.sale_items (sale_id, product_id);
CREATE TABLE IF NOT EXISTS public.sales ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "invoice_no" text DEFAULT ('INV-'::text || (nextval('invoice_seq'::regclass))::text) NOT NULL, "sale_date" timestamp with time zone DEFAULT now() NOT NULL, "grand_total" numeric(14,2) DEFAULT 0 NOT NULL, "created_by" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "customer_name" text, "status" text DEFAULT 'completed'::text NOT NULL, "delivery_charges" numeric(12,2) DEFAULT 0 NOT NULL, "payment_method" text DEFAULT 'cash'::text NOT NULL, "deleted_at" timestamp with time zone, "cash_paid" numeric(14,2) DEFAULT 0 NOT NULL, "online_paid" numeric(14,2) DEFAULT 0 NOT NULL, "order_type" text DEFAULT 'walk_in'::text NOT NULL, "delivery_boy" text, "katha" boolean DEFAULT false NOT NULL, "customer_id" uuid, "customer_phone" text, "whatsapp_status" text, "whatsapp_sent_at" timestamp with time zone, "discount_type" text DEFAULT 'amount'::text NOT NULL, "discount_value" numeric(12,2) DEFAULT 0 NOT NULL, "discount_amount" numeric(12,2) DEFAULT 0 NOT NULL, "delivery_address" text, "hidden" boolean DEFAULT false NOT NULL, "staff_id" uuid);
CREATE TABLE IF NOT EXISTS public.settings ("id" integer DEFAULT 1 NOT NULL, "allow_negative_stock" boolean DEFAULT false NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "whatsapp_token" text, "whatsapp_phone_id" text, "whatsapp_business_id" text, "whatsapp_country_code" text DEFAULT '92'::text, "whatsapp_auto_send" boolean DEFAULT true, "timezone" text DEFAULT 'Asia/Karachi'::text NOT NULL, "business_day_start_time" time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL, "business_month_start_day" integer DEFAULT 6 NOT NULL, "pin_locks" jsonb DEFAULT '{}'::jsonb NOT NULL, "staff_invoice_color" text DEFAULT '#DBEAFE'::text NOT NULL);
CREATE TABLE IF NOT EXISTS public.staff ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "father_name" text, "phone" text, "cnic" text, "joining_date" date DEFAULT CURRENT_DATE NOT NULL, "monthly_salary" numeric(14,2) DEFAULT 0 NOT NULL, "status" text DEFAULT 'active'::text NOT NULL, "notes" text, "opening_katha" numeric(14,2) DEFAULT 0 NOT NULL, "katha_balance" numeric(14,2) DEFAULT 0 NOT NULL, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.staff_attendance ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "staff_id" uuid NOT NULL, "date" date NOT NULL, "status" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.staff_month_carry ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "staff_id" uuid NOT NULL, "year" integer NOT NULL, "month" integer NOT NULL, "prev_remaining" numeric DEFAULT 0 NOT NULL, "prev_advance" numeric DEFAULT 0 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.staff_payments ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "staff_id" uuid NOT NULL, "kind" text NOT NULL, "amount" numeric(14,2) NOT NULL, "payment_method" text DEFAULT 'cash'::text NOT NULL, "remark" text, "date" date DEFAULT CURRENT_DATE NOT NULL, "cash_movement_id" uuid, "created_by" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.stock_adjustments ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "scope" text NOT NULL, "product_id" uuid, "stock_item_id" uuid, "quantity" numeric NOT NULL, "reason" text, "notes" text, "date" date DEFAULT ((now() AT TIME ZONE 'Asia/Karachi'::text))::date NOT NULL, "created_by" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.stock_items ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "unit" text DEFAULT 'pcs'::text NOT NULL, "opening_stock" numeric(12,3) DEFAULT 0 NOT NULL, "current_stock" numeric(12,3) DEFAULT 0 NOT NULL, "minimum_stock" numeric(12,3) DEFAULT 0 NOT NULL, "purchase_price" numeric(12,2) DEFAULT 0 NOT NULL, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL, "category" text NOT NULL, "supplier_id" uuid, "purchase_date" date, "notes" text, "avg_price_override" numeric, "auto_calc" boolean DEFAULT false NOT NULL);
CREATE TABLE IF NOT EXISTS public.stock_opening_snapshots ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "scope" text NOT NULL, "item_id" uuid NOT NULL, "year" integer NOT NULL, "month" integer NOT NULL, "quantity" numeric DEFAULT 0 NOT NULL, "unit_value" numeric DEFAULT 0 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.stock_purchases ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "date" date DEFAULT CURRENT_DATE NOT NULL, "product_id" uuid, "stock_item_id" uuid, "quantity" numeric(12,3) NOT NULL, "unit_cost" numeric(12,2) NOT NULL, "total_cost" numeric(14,2) NOT NULL, "supplier" text, "notes" text, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "category" text NOT NULL, "payment_status" text DEFAULT 'paid'::text NOT NULL, "paid_amount" numeric(14,2) DEFAULT 0 NOT NULL, "paid_at" timestamp with time zone, "payment_source" text DEFAULT 'cash'::text NOT NULL, "purchase_item_id" uuid);
CREATE TABLE IF NOT EXISTS public.stock_transfers ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "item_type" text NOT NULL, "product_id" uuid, "stock_item_id" uuid, "item_name" text NOT NULL, "from_category" text NOT NULL, "to_category" text NOT NULL, "quantity" numeric(14,3) NOT NULL, "unit" text DEFAULT 'pcs'::text NOT NULL, "unit_cost" numeric(14,4) DEFAULT 0 NOT NULL, "total_cost" numeric(14,2) DEFAULT 0 NOT NULL, "reason" text, "notes" text, "created_by" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "deleted_at" timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.suppliers ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "phone" text, "address" text, "balance" numeric(14,2) DEFAULT 0 NOT NULL, "notes" text, "deleted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.user_roles ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "user_id" uuid NOT NULL, "role" app_role DEFAULT 'staff'::app_role NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
DO $x$ BEGIN ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.branches ADD CONSTRAINT branches_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.categories ADD CONSTRAINT categories_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.daily_closings ADD CONSTRAINT daily_closings_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.delivery_expenses ADD CONSTRAINT delivery_expenses_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.expense_categories ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.expenses ADD CONSTRAINT expenses_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.katha_opening ADD CONSTRAINT katha_opening_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.money_movement_subcategories ADD CONSTRAINT money_movement_subcategories_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.monthly_stock_overrides ADD CONSTRAINT monthly_stock_overrides_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.production_batch_items ADD CONSTRAINT production_batch_items_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchases ADD CONSTRAINT purchases_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.recipes ADD CONSTRAINT recipes_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff ADD CONSTRAINT staff_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_attendance ADD CONSTRAINT staff_attendance_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_month_carry ADD CONSTRAINT staff_month_carry_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_payments ADD CONSTRAINT staff_payments_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_adjustments ADD CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_opening_snapshots ADD CONSTRAINT stock_opening_snapshots_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_purchases ADD CONSTRAINT stock_purchases_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.categories ADD CONSTRAINT categories_name_key UNIQUE (name); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.daily_closings ADD CONSTRAINT daily_closings_closing_date_key UNIQUE (closing_date); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.expense_categories ADD CONSTRAINT expense_categories_name_key UNIQUE (name); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.money_movement_subcategories ADD CONSTRAINT money_movement_subcategories_category_name_key UNIQUE (category, name); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_invoice_no_key UNIQUE (invoice_no); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_attendance ADD CONSTRAINT staff_attendance_uniq UNIQUE (staff_id, date); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_month_carry ADD CONSTRAINT staff_month_carry_staff_id_year_month_key UNIQUE (staff_id, year, month); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_opening_snapshots ADD CONSTRAINT stock_opening_snapshots_scope_item_id_year_month_key UNIQUE (scope, item_id, year, month); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_payment_source_chk CHECK ((payment_source = ANY (ARRAY['cash'::text, 'online'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_amount_check CHECK ((amount >= (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_katha_category_chk CHECK ((katha_category = ANY (ARRAY['transaction'::text, 'katha'::text, 'loan_get'::text, 'loan_paid'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_type_check CHECK ((type = ANY (ARRAY['cash_in'::text, 'cash_out'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_method_chk CHECK ((payment_method = ANY (ARRAY['cash'::text, 'online'::text, 'stock_transfer'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_status_check CHECK ((payment_status = ANY (ARRAY['paid'::text, 'unpaid'::text, 'partial'::text, 'katha'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_source_check CHECK ((payment_source = ANY (ARRAY['cash'::text, 'online'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.katha_opening ADD CONSTRAINT katha_opening_singleton CHECK ((id = 1)); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.money_movement_subcategories ADD CONSTRAINT money_movement_subcategories_category_check CHECK ((category = ANY (ARRAY['Expense'::text, 'Owner'::text, 'Customer'::text, 'Other'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.monthly_stock_overrides ADD CONSTRAINT monthly_stock_overrides_month_check CHECK (((month >= 1) AND (month <= 12))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.monthly_stock_overrides ADD CONSTRAINT monthly_stock_overrides_scope_check CHECK ((scope = ANY (ARRAY['product'::text, 'stock_item'::text, 'category'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.production_batch_items ADD CONSTRAINT production_batch_items_component_type_check CHECK ((component_type = ANY (ARRAY['product'::text, 'stock_item'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_quantity_check CHECK ((quantity > (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.products ADD CONSTRAINT products_unit_check CHECK ((unit = ANY (ARRAY['pcs'::text, 'kg'::text, 'ltr'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.products ADD CONSTRAINT products_selling_method_check CHECK ((selling_method = ANY (ARRAY['fixed'::text, 'weight'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_check CHECK (((product_id IS NOT NULL) <> (stock_item_id IS NOT NULL))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchases ADD CONSTRAINT purchases_payment_status_check CHECK ((payment_status = ANY (ARRAY['paid'::text, 'unpaid'::text, 'katha'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchases ADD CONSTRAINT purchases_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'online'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.recipes ADD CONSTRAINT recipes_applies_to_chk CHECK (((array_length(applies_to, 1) IS NOT NULL) AND (applies_to <@ ARRAY['walk_in'::text, 'take_away'::text, 'delivery'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.recipes ADD CONSTRAINT recipes_component_xor CHECK (((((component_product_id IS NOT NULL))::integer + ((component_stock_item_id IS NOT NULL))::integer) = 1)); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.recipes ADD CONSTRAINT recipes_quantity_check CHECK ((quantity > (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_order_type_check CHECK ((order_type = ANY (ARRAY['walk_in'::text, 'take_away'::text, 'delivery'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'card'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_discount_type_check CHECK ((discount_type = ANY (ARRAY['amount'::text, 'percent'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.settings ADD CONSTRAINT settings_id_check CHECK ((id = 1)); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.settings ADD CONSTRAINT settings_business_month_start_day_check CHECK (((business_month_start_day >= 1) AND (business_month_start_day <= 28))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff ADD CONSTRAINT staff_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_attendance ADD CONSTRAINT staff_attendance_status_chk CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_month_carry ADD CONSTRAINT staff_month_carry_month_check CHECK (((month >= 1) AND (month <= 12))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_payments ADD CONSTRAINT staff_payments_method_chk CHECK ((payment_method = ANY (ARRAY['cash'::text, 'online'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_payments ADD CONSTRAINT staff_payments_kind_chk CHECK ((kind = ANY (ARRAY['salary'::text, 'advance'::text, 'katha_receipt'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_adjustments ADD CONSTRAINT stock_adjustments_scope_check CHECK ((scope = ANY (ARRAY['product'::text, 'stock_item'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_opening_snapshots ADD CONSTRAINT stock_opening_snapshots_month_check CHECK (((month >= 1) AND (month <= 12))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_opening_snapshots ADD CONSTRAINT stock_opening_snapshots_scope_check CHECK ((scope = ANY (ARRAY['product'::text, 'stock_item'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_purchases ADD CONSTRAINT stock_purchases_check CHECK (((product_id IS NOT NULL) <> (stock_item_id IS NOT NULL))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_purchases ADD CONSTRAINT stock_purchases_payment_source_check CHECK ((payment_source = ANY (ARRAY['cash'::text, 'online'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_purchases ADD CONSTRAINT stock_purchases_payment_status_check CHECK ((payment_status = ANY (ARRAY['paid'::text, 'unpaid'::text, 'partial'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_item_type_check CHECK ((item_type = ANY (ARRAY['product'::text, 'stock_item'::text]))); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_quantity_check CHECK ((quantity > (0)::numeric)); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.expenses ADD CONSTRAINT expenses_source_product_id_fkey FOREIGN KEY (source_product_id) REFERENCES products(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.expenses ADD CONSTRAINT expenses_source_stock_item_id_fkey FOREIGN KEY (source_stock_item_id) REFERENCES stock_items(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.monthly_stock_overrides ADD CONSTRAINT monthly_stock_overrides_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.monthly_stock_overrides ADD CONSTRAINT monthly_stock_overrides_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.production_batch_items ADD CONSTRAINT production_batch_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.production_batch_items ADD CONSTRAINT production_batch_items_component_stock_item_id_fkey FOREIGN KEY (component_stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.production_batch_items ADD CONSTRAINT production_batch_items_component_product_id_fkey FOREIGN KEY (component_product_id) REFERENCES products(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.purchases ADD CONSTRAINT purchases_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.recipes ADD CONSTRAINT recipes_component_product_id_fkey FOREIGN KEY (component_product_id) REFERENCES products(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.recipes ADD CONSTRAINT recipes_component_stock_item_id_fkey FOREIGN KEY (component_stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.recipes ADD CONSTRAINT recipes_parent_product_id_fkey FOREIGN KEY (parent_product_id) REFERENCES products(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.sales ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_attendance ADD CONSTRAINT staff_attendance_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_month_carry ADD CONSTRAINT staff_month_carry_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.staff_payments ADD CONSTRAINT staff_payments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_adjustments ADD CONSTRAINT stock_adjustments_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_adjustments ADD CONSTRAINT stock_adjustments_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_purchases ADD CONSTRAINT stock_purchases_purchase_item_id_fkey FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_purchases ADD CONSTRAINT stock_purchases_stock_item_fk FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_purchases ADD CONSTRAINT stock_purchases_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_stock_item_id_fkey FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
DO $x$ BEGIN ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN invalid_table_definition THEN NULL; END $x$;
CREATE INDEX IF NOT EXISTS recipes_parent_idx ON public.recipes USING btree (parent_product_id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS money_movement_subcategories_category_name_key ON public.money_movement_subcategories USING btree (category, name);
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_no_key ON public.sales USING btree (invoice_no);
CREATE INDEX IF NOT EXISTS sales_hidden_idx ON public.sales USING btree (hidden);
CREATE INDEX IF NOT EXISTS idx_sales_staff_id ON public.sales USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items USING btree (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON public.purchase_items USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_stock_item ON public.purchase_items USING btree (stock_item_id);
CREATE INDEX IF NOT EXISTS products_name_idx ON public.products USING btree (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_key ON public.categories USING btree (name);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique_active ON public.categories USING btree (lower(name)) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_role_key ON public.user_roles USING btree (user_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS stock_opening_snapshots_scope_item_id_year_month_key ON public.stock_opening_snapshots USING btree (scope, item_id, year, month);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_created_at ON public.stock_transfers USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON public.stock_transfers USING btree (from_category);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON public.stock_transfers USING btree (to_category);
CREATE UNIQUE INDEX IF NOT EXISTS staff_month_carry_staff_id_year_month_key ON public.staff_month_carry USING btree (staff_id, year, month);
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_name_key ON public.expense_categories USING btree (name);
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_name_uniq ON public.stock_items USING btree (lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_purchase_item ON public.stock_purchases USING btree (purchase_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_attendance_uniq ON public.staff_attendance USING btree (staff_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON public.customers USING btree (phone) WHERE ((phone IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_cash_movements_reference ON public.cash_movements USING btree (reference_type, reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS msoverr_uniq_prod ON public.monthly_stock_overrides USING btree (product_id, year, month) WHERE (scope = 'product'::text);
CREATE UNIQUE INDEX IF NOT EXISTS msoverr_uniq_item ON public.monthly_stock_overrides USING btree (stock_item_id, year, month) WHERE (scope = 'stock_item'::text);
CREATE UNIQUE INDEX IF NOT EXISTS msoverr_uniq_cat ON public.monthly_stock_overrides USING btree (category, year, month) WHERE (scope = 'category'::text);
CREATE INDEX IF NOT EXISTS idx_staff_payments_staff_date ON public.staff_payments USING btree (staff_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS daily_closings_closing_date_key ON public.daily_closings USING btree (closing_date);
CREATE INDEX IF NOT EXISTS stock_adjustments_date_idx ON public.stock_adjustments USING btree (date);

CREATE OR REPLACE FUNCTION public.save_sale(_items jsonb, _customer_name text DEFAULT NULL::text, _status text DEFAULT 'completed'::text, _delivery_charges numeric DEFAULT 0, _payment_method text DEFAULT 'cash'::text)
 RETURNS sales
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale public.sales;
  v_item jsonb;
  v_subtotal numeric(14,2) := 0;
  v_product public.products;
  v_uid uuid := auth.uid();
  v_match_rows int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;

  INSERT INTO public.sales (grand_total, created_by, customer_name, status, delivery_charges, payment_method)
  VALUES (0, v_uid, NULLIF(trim(_customer_name), ''), _status, COALESCE(_delivery_charges,0), _payment_method)
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND deleted_at IS NULL;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total)
    VALUES (v_sale.id, v_product.id, (v_item->>'quantity')::numeric, v_product.sale_price,
            v_product.sale_price * (v_item->>'quantity')::numeric);
    v_subtotal := v_subtotal + v_product.sale_price * (v_item->>'quantity')::numeric;

    IF _status = 'completed' THEN
      -- Decrement own product's current_stock
      UPDATE public.products
        SET current_stock = current_stock - (v_item->>'quantity')::numeric
        WHERE id = v_product.id;
      -- Also decrement any stock_item with matching name (name-based deduction)
      UPDATE public.stock_items
        SET current_stock = current_stock - (v_item->>'quantity')::numeric, updated_at = now()
        WHERE lower(trim(name)) = lower(trim(v_product.name)) AND deleted_at IS NULL;
    END IF;
  END LOOP;

  UPDATE public.sales
    SET grand_total = v_subtotal + COALESCE(_delivery_charges,0)
    WHERE id = v_sale.id
    RETURNING * INTO v_sale;
  RETURN v_sale;
END $function$
;

CREATE OR REPLACE FUNCTION public.dashboard_category_cards()
 RETURNS TABLE(category text, color text, icon text, today_sales numeric, month_sales numeric, today_orders bigint, month_orders bigint, month_cogs numeric, month_profit numeric, top_product text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_today date := public.business_date(now()); v_month_start date := date_trunc('month', v_today)::date;
BEGIN
  RETURN QUERY
  WITH cats AS (SELECT name, color, icon FROM public.categories WHERE deleted_at IS NULL AND active),
  rows AS (
    SELECT p.category AS cat, public.business_date(s.sale_date) AS bd,
      si.total AS revenue, si.quantity AS qty, si.id AS si_id, s.id AS sale_id, p.name AS pname,
      CASE WHEN EXISTS(SELECT 1 FROM public.recipes r WHERE r.parent_product_id = p.id AND r.deleted_at IS NULL)
        THEN COALESCE((SELECT SUM(r.quantity * COALESCE(cp.cost_price,0))
            FROM public.recipes r JOIN public.products cp ON cp.id = r.component_product_id
            WHERE r.parent_product_id = p.id AND r.deleted_at IS NULL), 0) * si.quantity
        ELSE COALESCE(p.cost_price,0) * si.quantity END AS cogs
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
    WHERE s.deleted_at IS NULL AND s.status = 'completed'
      AND public.business_date(s.sale_date) >= v_month_start
  ),
  agg AS (
    SELECT cat,
      SUM(CASE WHEN bd = v_today THEN revenue ELSE 0 END) AS today_sales,
      SUM(revenue) AS month_sales,
      COUNT(DISTINCT CASE WHEN bd = v_today THEN sale_id END) AS today_orders,
      COUNT(DISTINCT sale_id) AS month_orders,
      SUM(cogs) AS month_cogs
    FROM rows GROUP BY cat
  ),
  top AS (
    SELECT DISTINCT ON (cat) cat, pname FROM (
      SELECT cat, pname, SUM(qty) AS q FROM rows GROUP BY cat, pname
    ) z ORDER BY cat, q DESC
  )
  SELECT c.name, c.color, c.icon,
    COALESCE(a.today_sales,0), COALESCE(a.month_sales,0),
    COALESCE(a.today_orders,0), COALESCE(a.month_orders,0),
    COALESCE(a.month_cogs,0), COALESCE(a.month_sales,0) - COALESCE(a.month_cogs,0),
    t.pname
  FROM cats c LEFT JOIN agg a ON a.cat = c.name LEFT JOIN top t ON t.cat = c.name
  ORDER BY c.name;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_purchase_recalc_wac()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF NEW.product_id IS NOT NULL THEN PERFORM public.recompute_product_wac(NEW.product_id); END IF;
    IF NEW.stock_item_id IS NOT NULL THEN PERFORM public.recompute_stock_item_wac(NEW.stock_item_id); END IF;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF OLD.product_id IS NOT NULL AND (TG_OP='DELETE' OR OLD.product_id IS DISTINCT FROM NEW.product_id) THEN
      PERFORM public.recompute_product_wac(OLD.product_id);
    END IF;
    IF OLD.stock_item_id IS NOT NULL AND (TG_OP='DELETE' OR OLD.stock_item_id IS DISTINCT FROM NEW.stock_item_id) THEN
      PERFORM public.recompute_stock_item_wac(OLD.stock_item_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$
;

CREATE OR REPLACE FUNCTION public.delete_production_batch(_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch public.production_batches;
  v_item RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_batch FROM public.production_batches WHERE id = _batch_id AND deleted_at IS NULL;
  IF v_batch IS NULL THEN RETURN; END IF;
  FOR v_item IN SELECT * FROM public.production_batch_items WHERE batch_id = _batch_id LOOP
    IF v_item.component_type = 'product' AND v_item.component_product_id IS NOT NULL THEN
      UPDATE public.products SET current_stock = current_stock + v_item.quantity
        WHERE id = v_item.component_product_id;
    ELSIF v_item.component_type = 'stock_item' AND v_item.component_stock_item_id IS NOT NULL THEN
      UPDATE public.stock_items SET current_stock = current_stock + v_item.quantity, updated_at = now()
        WHERE id = v_item.component_stock_item_id;
    END IF;
  END LOOP;
  UPDATE public.products SET current_stock = GREATEST(current_stock - v_batch.quantity, 0)
    WHERE id = v_batch.product_id;
  UPDATE public.production_batches SET deleted_at = now() WHERE id = _batch_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.apply_stock_for_sale_item(_product_id uuid, _quantity numeric, _sign integer, _order_type text DEFAULT 'walk_in'::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_recipe boolean;
  v_track boolean;
  v_auto boolean;
  v_allow_neg boolean;
  v_comp RECORD;
  v_new_stock numeric;
  v_product_name text;
  v_ot text := COALESCE(_order_type, 'walk_in');
BEGIN
  SELECT allow_negative_stock INTO v_allow_neg FROM public.settings WHERE id = 1;
  IF v_allow_neg IS NULL THEN v_allow_neg := false; END IF;

  SELECT track_stock, auto_calc, name INTO v_track, v_auto, v_product_name
  FROM public.products WHERE id = _product_id;
  IF v_track IS NULL THEN v_track := true; END IF;
  IF v_auto IS NULL THEN v_auto := false; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.recipes
    WHERE parent_product_id = _product_id AND deleted_at IS NULL AND v_ot = ANY(applies_to)
  ) INTO v_has_recipe;

  IF v_has_recipe THEN
    FOR v_comp IN
      SELECT p.id AS pid, r.quantity * _quantity AS qty, p.name,
             p.allow_negative_stock AS p_allow_neg,
             COALESCE(p.track_stock, true) AS p_track,
             COALESCE(p.auto_calc, false) AS p_auto
      FROM public.recipes r
      JOIN public.products p ON p.id = r.component_product_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
        AND r.component_product_id IS NOT NULL
        AND v_ot = ANY(r.applies_to)
    LOOP
      IF NOT v_comp.p_track THEN
        CONTINUE; -- Stock Tracking OFF: unlimited, never deducted or validated
      END IF;
      UPDATE public.products SET current_stock = current_stock - (_sign * v_comp.qty)
        WHERE id = v_comp.pid RETURNING current_stock INTO v_new_stock;
      -- Only a manually maintained item can block a sale; auto items are
      -- rebuilt by the inventory engine, so the stored value is not trusted.
      IF _sign > 0 AND NOT v_comp.p_auto AND v_new_stock < 0
         AND NOT v_allow_neg AND NOT v_comp.p_allow_neg THEN
        RAISE EXCEPTION 'Insufficient stock for %', v_comp.name;
      END IF;
      UPDATE public.stock_items
        SET current_stock = current_stock - (_sign * v_comp.qty), updated_at = now()
        WHERE lower(trim(name)) = lower(trim(v_comp.name)) AND deleted_at IS NULL;
    END LOOP;
    FOR v_comp IN
      SELECT si.id AS sid, r.quantity * _quantity AS qty, si.name
      FROM public.recipes r
      JOIN public.stock_items si ON si.id = r.component_stock_item_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
        AND r.component_stock_item_id IS NOT NULL
        AND v_ot = ANY(r.applies_to)
    LOOP
      UPDATE public.stock_items
        SET current_stock = current_stock - (_sign * v_comp.qty), updated_at = now()
        WHERE id = v_comp.sid;
    END LOOP;
  ELSIF v_track THEN
    UPDATE public.products SET current_stock = current_stock - (_sign * _quantity)
      WHERE id = _product_id RETURNING current_stock INTO v_new_stock;
    IF _sign > 0 AND NOT v_auto AND v_new_stock < 0 AND NOT v_allow_neg THEN
      PERFORM 1 FROM public.products WHERE id = _product_id AND allow_negative_stock = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for %', v_product_name;
      END IF;
    END IF;
    UPDATE public.stock_items
      SET current_stock = current_stock - (_sign * _quantity), updated_at = now()
      WHERE lower(trim(v_product_name)) = lower(trim(name)) AND deleted_at IS NULL;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  user_count int;
BEGIN
  SELECT count(*) INTO user_count FROM auth.users;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN user_count <= 1 THEN 'admin'::public.app_role ELSE 'staff'::public.app_role END);
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$
;

CREATE OR REPLACE FUNCTION public.save_sale(_items jsonb, _customer_name text DEFAULT NULL::text, _status text DEFAULT 'completed'::text, _delivery_charges numeric DEFAULT 0, _payment_method text DEFAULT 'cash'::text, _cash_paid numeric DEFAULT 0, _online_paid numeric DEFAULT 0, _order_type text DEFAULT 'walk_in'::text, _delivery_boy text DEFAULT NULL::text, _customer_phone text DEFAULT NULL::text, _katha boolean DEFAULT false, _discount_type text DEFAULT 'amount'::text, _discount_value numeric DEFAULT 0, _delivery_address text DEFAULT NULL::text)
 RETURNS sales
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale public.sales; v_item jsonb; v_subtotal numeric(14,2) := 0;
  v_product public.products; v_uid uuid := auth.uid();
  v_qty numeric; v_rate numeric; v_total numeric; v_delivery numeric;
  v_customer_id uuid; v_discount_amt numeric(14,2); v_remaining numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;
  IF _discount_type NOT IN ('amount','percent') THEN _discount_type := 'amount'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;

  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

  IF NULLIF(trim(_customer_phone),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE phone = trim(_customer_phone) AND deleted_at IS NULL LIMIT 1;
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (name, phone) VALUES (COALESCE(NULLIF(trim(_customer_name),''),'Guest'), trim(_customer_phone)) RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  INSERT INTO public.sales (
    grand_total, created_by, customer_name, status, delivery_charges, payment_method,
    cash_paid, online_paid, order_type, delivery_boy, customer_id, customer_phone,
    katha, discount_type, discount_value, discount_amount, delivery_address
  )
  VALUES (0, v_uid, NULLIF(trim(_customer_name), ''), _status, v_delivery, _payment_method,
    COALESCE(_cash_paid,0), COALESCE(_online_paid,0), _order_type, NULLIF(trim(_delivery_boy),''),
    v_customer_id, NULLIF(trim(_customer_phone),''), COALESCE(_katha,false),
    _discount_type, COALESCE(_discount_value,0), 0, NULLIF(trim(_delivery_address),''))
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND deleted_at IS NULL;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
    v_qty := (v_item->>'quantity')::numeric;
    v_rate := COALESCE(NULLIF(v_item->>'rate','')::numeric, v_product.sale_price);
    v_total := round(v_qty * v_rate, 2);
    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total, unit)
    VALUES (v_sale.id, v_product.id, v_qty, v_rate, v_total, COALESCE(v_item->>'unit', v_product.unit));
    v_subtotal := v_subtotal + v_total;
    PERFORM public.apply_stock_for_sale_item(v_product.id, v_qty, 1, _order_type);
    IF _status = 'completed' THEN
      UPDATE public.products SET last_sold_at = now() WHERE id = v_product.id;
    END IF;
  END LOOP;

  IF _discount_type = 'percent' THEN
    v_discount_amt := round(v_subtotal * LEAST(GREATEST(COALESCE(_discount_value,0),0),100) / 100.0, 2);
  ELSE
    v_discount_amt := LEAST(GREATEST(COALESCE(_discount_value,0),0), v_subtotal);
  END IF;

  UPDATE public.sales
    SET grand_total = GREATEST(v_subtotal - v_discount_amt, 0) + v_delivery,
        discount_amount = v_discount_amt
    WHERE id = v_sale.id RETURNING * INTO v_sale;

  IF v_customer_id IS NOT NULL AND _status = 'completed' THEN
    v_remaining := GREATEST(v_sale.grand_total - COALESCE(_cash_paid,0) - COALESCE(_online_paid,0), 0);
    UPDATE public.customers SET
      last_visit = now(),
      total_orders = total_orders + 1,
      total_purchases = total_purchases + v_sale.grand_total,
      outstanding_balance = outstanding_balance + CASE WHEN COALESCE(_katha,false) THEN v_remaining ELSE 0 END
    WHERE id = v_customer_id;
  END IF;
  RETURN v_sale;
END $function$
;

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
END $function$
;

CREATE OR REPLACE FUNCTION public.daily_closing_summary(_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev public.daily_closings%ROWTYPE;
  v_curr public.daily_closings%ROWTYPE;
  v_opening_cash numeric := 0;
  v_opening_wallet numeric := 0;
  v_cash_sales numeric := 0;
  v_online_sales numeric := 0;
  v_katha numeric := 0;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_online_in numeric := 0;
  v_online_out numeric := 0;
  v_cash_exp numeric := 0;
  v_online_exp numeric := 0;
  v_invoices int := 0;
BEGIN
  SELECT * INTO v_prev FROM public.daily_closings
   WHERE closing_date < _date ORDER BY closing_date DESC LIMIT 1;
  IF FOUND THEN
    v_opening_cash := v_prev.actual_cash;
    v_opening_wallet := v_prev.actual_wallet;
  END IF;

  SELECT
    COALESCE(SUM(cash_paid),0),
    COALESCE(SUM(online_paid),0),
    COALESCE(SUM(CASE WHEN katha THEN GREATEST(grand_total - cash_paid - online_paid, 0) ELSE 0 END),0),
    COUNT(*)
  INTO v_cash_sales, v_online_sales, v_katha, v_invoices
  FROM public.sales
  WHERE deleted_at IS NULL AND NOT hidden AND status = 'completed'
    AND public.business_date_of(sale_date) = _date;

  SELECT
    COALESCE(SUM(CASE WHEN type='cash_in'  AND COALESCE(payment_source,'cash')='cash'   THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_out' AND COALESCE(payment_source,'cash')='cash'   THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_in'  AND payment_source='online' THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_out' AND payment_source='online' THEN amount END),0)
  INTO v_cash_in, v_cash_out, v_online_in, v_online_out
  FROM public.cash_movements
  WHERE deleted_at IS NULL AND business_date = _date;

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(payment_method,'')='cash'   AND COALESCE(payment_status,'paid')='paid' AND NOT COALESCE(is_stock_transfer,false) THEN amount END),0),
    COALESCE(SUM(CASE WHEN COALESCE(payment_method,'')='online' AND COALESCE(payment_status,'paid')='paid' AND NOT COALESCE(is_stock_transfer,false) THEN amount END),0)
  INTO v_cash_exp, v_online_exp
  FROM public.expenses
  WHERE deleted_at IS NULL AND date = _date;

  v_cash_exp := v_cash_exp + COALESCE((
    SELECT SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0))
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND date = _date
      AND payment_status = 'paid' AND payment_method = 'cash'
  ), 0);
  v_online_exp := v_online_exp + COALESCE((
    SELECT SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0))
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND date = _date
      AND payment_status = 'paid' AND payment_method = 'online'
  ), 0);

  SELECT * INTO v_curr FROM public.daily_closings WHERE closing_date = _date;

  RETURN jsonb_build_object(
    'closing_date', _date,
    'opening_cash', v_opening_cash,
    'opening_wallet', v_opening_wallet,
    'cash_sales', v_cash_sales,
    'online_sales', v_online_sales,
    'katha', v_katha,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'online_in', v_online_in,
    'online_out', v_online_out,
    'cash_expenses', v_cash_exp,
    'online_expenses', v_online_exp,
    'invoices', v_invoices,
    'expected_cash',   v_opening_cash   + v_cash_sales   + v_cash_in   - v_cash_out   - v_cash_exp,
    'expected_wallet', v_opening_wallet + v_online_sales + v_online_in - v_online_out - v_online_exp,
    'actual_cash',   CASE WHEN v_curr.id IS NOT NULL THEN v_curr.actual_cash   ELSE NULL END,
    'actual_wallet', CASE WHEN v_curr.id IS NOT NULL THEN v_curr.actual_wallet ELSE NULL END,
    'closed', v_curr.id IS NOT NULL,
    'notes', v_curr.notes
  );
END; $function$
;

CREATE OR REPLACE FUNCTION public.update_stock_transfer_expense(_expense_id uuid, _quantity numeric, _date date, _category text, _description text, _notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.expenses%ROWTYPE;
  v_delta numeric;
  v_new_amount numeric;
BEGIN
  SELECT * INTO r FROM public.expenses WHERE id = _expense_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF NOT r.is_stock_transfer THEN RAISE EXCEPTION 'Not a stock transfer expense'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be > 0'; END IF;

  v_delta := COALESCE(r.source_quantity,0) - _quantity; -- positive => restore stock; negative => reduce more
  v_new_amount := round(COALESCE(r.source_unit_cost,0) * _quantity, 2);

  IF r.source_product_id IS NOT NULL THEN
    UPDATE public.products SET current_stock = COALESCE(current_stock,0) + v_delta WHERE id = r.source_product_id;
  ELSIF r.source_stock_item_id IS NOT NULL THEN
    UPDATE public.stock_items SET current_stock = COALESCE(current_stock,0) + v_delta, updated_at = now() WHERE id = r.source_stock_item_id;
  END IF;

  UPDATE public.expenses
    SET source_quantity = _quantity,
        amount = v_new_amount,
        paid_amount = v_new_amount,
        date = COALESCE(_date, r.date),
        category = COALESCE(NULLIF(trim(_category),''), r.category),
        description = _description,
        notes = _notes
    WHERE id = _expense_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_sale_stock(_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale public.sales;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF v_sale IS NULL OR v_sale.status NOT IN ('pending','completed') THEN RETURN; END IF;
  FOR v_item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id LOOP
    PERFORM public.apply_stock_for_sale_item(v_item.product_id, v_item.quantity, -1, v_sale.order_type);
  END LOOP;
END $function$
;

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
END $function$
;

CREATE OR REPLACE FUNCTION public.digi_katha_summary(_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_get numeric := 0; v_prev_give numeric := 0;
  v_katha_sales numeric := 0; v_loan_given numeric := 0; v_loan_recovered numeric := 0;
  v_pur_katha numeric := 0; v_exp_katha numeric := 0; v_del_katha numeric := 0;
  v_loan_taken numeric := 0; v_loan_repaid numeric := 0;
  v_p_sales numeric := 0; v_p_given numeric := 0; v_p_recovered numeric := 0;
  v_p_pur numeric := 0; v_p_exp numeric := 0; v_p_del numeric := 0; v_p_taken numeric := 0; v_p_repaid numeric := 0;
  v_open_get numeric := 0; v_open_give numeric := 0; v_from date;
BEGIN
  SELECT COALESCE(opening_loan_to_get,0), COALESCE(opening_loan_to_give,0), as_of_date
    INTO v_open_get, v_open_give, v_from FROM public.katha_opening WHERE id = 1;
  v_open_get := COALESCE(v_open_get,0); v_open_give := COALESCE(v_open_give,0);
  v_from := COALESCE(v_from, '1900-01-01'::date);

  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_p_sales
    FROM public.sales WHERE deleted_at IS NULL AND NOT hidden AND status='completed' AND katha
      AND staff_id IS NULL
      AND public.business_date_of(sale_date) >= v_from
      AND public.business_date_of(sale_date) < _date;
  SELECT
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_out' THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_get'  AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_out' THEN amount END),0)
  INTO v_p_given, v_p_recovered, v_p_taken, v_p_repaid
  FROM public.cash_movements WHERE deleted_at IS NULL AND business_date >= v_from AND business_date < _date;
  SELECT COALESCE(SUM(grand_total),0) INTO v_p_pur FROM public.purchases
    WHERE deleted_at IS NULL AND payment_status='katha' AND date >= v_from AND date < _date;
  SELECT COALESCE(SUM(amount),0) INTO v_p_exp FROM public.expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND COALESCE(is_stock_transfer,false) = false
      AND date >= v_from AND date < _date;
  SELECT COALESCE(SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0)),0) INTO v_p_del
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND date >= v_from AND date < _date;

  v_prev_get  := v_open_get + v_p_sales + v_p_given - v_p_recovered;
  v_prev_give := v_open_give + v_p_pur + v_p_exp + v_p_del + v_p_taken - v_p_repaid;

  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_katha_sales
    FROM public.sales WHERE deleted_at IS NULL AND NOT hidden AND status='completed' AND katha
      AND staff_id IS NULL
      AND public.business_date_of(sale_date) = _date AND _date >= v_from;
  SELECT
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_out' THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_get'  AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_out' THEN amount END),0)
  INTO v_loan_given, v_loan_recovered, v_loan_taken, v_loan_repaid
  FROM public.cash_movements WHERE deleted_at IS NULL AND business_date = _date AND _date >= v_from;
  SELECT COALESCE(SUM(grand_total),0) INTO v_pur_katha FROM public.purchases
    WHERE deleted_at IS NULL AND payment_status='katha' AND date = _date AND _date >= v_from;
  SELECT COALESCE(SUM(amount),0) INTO v_exp_katha FROM public.expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND COALESCE(is_stock_transfer,false) = false
      AND date = _date AND _date >= v_from;
  SELECT COALESCE(SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0)),0) INTO v_del_katha
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND date = _date AND _date >= v_from;

  RETURN jsonb_build_object(
    'business_date', _date,
    'opening_loan_to_get', v_open_get,
    'opening_loan_to_give', v_open_give,
    'previous_loan_to_get', v_prev_get,
    'previous_loan_to_give', v_prev_give,
    'katha_sales', v_katha_sales,
    'loan_given', v_loan_given,
    'loan_recovered', v_loan_recovered,
    'purchase_katha', v_pur_katha,
    'expense_katha', v_exp_katha,
    'delivery_expense_katha', v_del_katha,
    'loan_taken', v_loan_taken,
    'loan_repaid', v_loan_repaid,
    'expected_loan_to_get', v_prev_get + v_katha_sales + v_loan_given - v_loan_recovered,
    'expected_loan_to_give', v_prev_give + v_pur_katha + v_exp_katha + v_del_katha + v_loan_taken - v_loan_repaid
  );
END $function$;

-- Digi Katha: detailed list of every katha entry behind the totals.
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
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'date', p.date, 'label', COALESCE(NULLIF(p.category,''),'Purchase'), 'party', COALESCE(NULLIF(p.supplier,''),'-'), 'amount', p.grand_total) ORDER BY p.date, p.created_at)
      FROM public.purchases p
      WHERE p.deleted_at IS NULL AND p.payment_status='katha' AND p.date BETWEEN v_from AND _to
    ), '[]'::jsonb),
    'expense_katha', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'date', e.date, 'label', e.category, 'party', COALESCE(NULLIF(e.description,''), COALESCE(NULLIF(e.supplier,''),'-')), 'amount', e.amount) ORDER BY e.date, e.created_at)
      FROM public.expenses e
      WHERE e.deleted_at IS NULL AND e.payment_status='katha' AND COALESCE(e.is_stock_transfer,false)=false AND e.date BETWEEN v_from AND _to
    ), '[]'::jsonb),
    'delivery_expense_katha', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'date', d.date, 'label', 'Delivery', 'party', COALESCE(NULLIF(d.description,''),'-'), 'amount', COALESCE(d.fuel_cost,0)+COALESCE(d.maintenance_cost,0)) ORDER BY d.date, d.created_at)
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
