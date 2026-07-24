export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity: string | null
          entity_id: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
        }
        Update: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          amount: number
          business_date: string
          created_at: string
          deleted_at: string | null
          id: string
          movement_category: string | null
          notes: string | null
          occurred_at: string
          payment_source: string
          reason: string | null
          reference_id: string | null
          reference_type: string | null
          subcategory: string | null
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          business_date?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          movement_category?: string | null
          notes?: string | null
          occurred_at?: string
          payment_source?: string
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          subcategory?: string | null
          type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          business_date?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          movement_category?: string | null
          notes?: string | null
          occurred_at?: string
          payment_source?: string
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          subcategory?: string | null
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          deleted_at: string | null
          id: string
          last_visit: string | null
          name: string
          notes: string | null
          outstanding_balance: number
          phone: string | null
          total_orders: number
          total_purchases: number
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_visit?: string | null
          name: string
          notes?: string | null
          outstanding_balance?: number
          phone?: string | null
          total_orders?: number
          total_purchases?: number
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_visit?: string | null
          name?: string
          notes?: string | null
          outstanding_balance?: number
          phone?: string | null
          total_orders?: number
          total_purchases?: number
        }
        Relationships: []
      }
      daily_closings: {
        Row: {
          actual_cash: number
          actual_wallet: number
          closed_at: string
          closing_date: string
          created_at: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          actual_cash?: number
          actual_wallet?: number
          closed_at?: string
          closing_date: string
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          actual_cash?: number
          actual_wallet?: number
          closed_at?: string
          closing_date?: string
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      delivery_expenses: {
        Row: {
          created_at: string
          date: string
          deleted_at: string | null
          description: string | null
          fuel_cost: number
          id: string
          maintenance_cost: number
          payment_method: string | null
          payment_status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date?: string
          deleted_at?: string | null
          description?: string | null
          fuel_cost?: number
          id?: string
          maintenance_cost?: number
          payment_method?: string | null
          payment_status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          deleted_at?: string | null
          description?: string | null
          fuel_cost?: number
          id?: string
          maintenance_cost?: number
          payment_method?: string | null
          payment_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          active: boolean
          created_at: string
          deleted_at: string | null
          id: string
          joined_on: string | null
          name: string
          phone: string | null
          role: string | null
          salary: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          joined_on?: string | null
          name: string
          phone?: string | null
          role?: string | null
          salary?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          joined_on?: string | null
          name?: string
          phone?: string | null
          role?: string | null
          salary?: number
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          active: boolean
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          deleted_at: string | null
          description: string | null
          id: string
          is_stock_transfer: boolean
          notes: string | null
          paid_amount: number
          paid_at: string | null
          payment_method: string
          payment_source: string
          payment_status: string
          supplier: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          date?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_stock_transfer?: boolean
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_method?: string
          payment_source?: string
          payment_status?: string
          supplier?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_stock_transfer?: boolean
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_method?: string
          payment_source?: string
          payment_status?: string
          supplier?: string | null
        }
        Relationships: []
      }
      money_movement_subcategories: {
        Row: {
          active: boolean
          category: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      monthly_stock_overrides: {
        Row: {
          category: string | null
          closing_value: number | null
          created_at: string
          id: string
          month: number
          opening_value: number | null
          product_id: string | null
          scope: string
          stock_item_id: string | null
          updated_at: string
          year: number
        }
        Insert: {
          category?: string | null
          closing_value?: number | null
          created_at?: string
          id?: string
          month: number
          opening_value?: number | null
          product_id?: string | null
          scope: string
          stock_item_id?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          category?: string | null
          closing_value?: number | null
          created_at?: string
          id?: string
          month?: number
          opening_value?: number | null
          product_id?: string | null
          scope?: string
          stock_item_id?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_stock_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_stock_overrides_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      production_batch_items: {
        Row: {
          batch_id: string
          component_product_id: string | null
          component_stock_item_id: string | null
          component_type: string
          created_at: string
          id: string
          quantity: number
          source_category: string | null
          target_category: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          batch_id: string
          component_product_id?: string | null
          component_stock_item_id?: string | null
          component_type: string
          created_at?: string
          id?: string
          quantity: number
          source_category?: string | null
          target_category?: string | null
          total_cost: number
          unit_cost: number
        }
        Update: {
          batch_id?: string
          component_product_id?: string | null
          component_stock_item_id?: string | null
          component_type?: string
          created_at?: string
          id?: string
          quantity?: number
          source_category?: string | null
          target_category?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "production_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_items_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batch_items_component_stock_item_id_fkey"
            columns: ["component_stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      production_batches: {
        Row: {
          batch_date: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          notes: string | null
          product_id: string
          quantity: number
          target_category: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          batch_date?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          target_category?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          batch_date?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          target_category?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          allow_negative_stock: boolean
          category: string
          cost_price: number
          created_at: string
          current_stock: number
          deleted_at: string | null
          id: string
          last_sold_at: string | null
          minimum_stock: number
          name: string
          opening_stock: number
          sale_price: number
          selling_method: string
          track_stock: boolean
          unit: string
        }
        Insert: {
          active?: boolean
          allow_negative_stock?: boolean
          category: string
          cost_price?: number
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          last_sold_at?: string | null
          minimum_stock?: number
          name: string
          opening_stock?: number
          sale_price?: number
          selling_method?: string
          track_stock?: boolean
          unit?: string
        }
        Update: {
          active?: boolean
          allow_negative_stock?: boolean
          category?: string
          cost_price?: number
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          last_sold_at?: string | null
          minimum_stock?: number
          name?: string
          opening_stock?: number
          sale_price?: number
          selling_method?: string
          track_stock?: boolean
          unit?: string
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          category: string | null
          created_at: string
          id: string
          product_id: string | null
          purchase_id: string
          quantity: number
          stock_item_id: string | null
          total_cost: number
          unit: string | null
          unit_cost: number
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          purchase_id: string
          quantity: number
          stock_item_id?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          purchase_id?: string
          quantity?: number
          stock_item_id?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          cash_movement_id: string | null
          category: string | null
          created_at: string
          created_by: string | null
          date: string
          deleted_at: string | null
          grand_total: number
          id: string
          notes: string | null
          payment_method: string | null
          payment_status: string
          supplier: string | null
          updated_at: string
        }
        Insert: {
          cash_movement_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          deleted_at?: string | null
          grand_total?: number
          id?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          cash_movement_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          deleted_at?: string | null
          grand_total?: number
          id?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          supplier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          applies_to: string[]
          component_product_id: string | null
          component_stock_item_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          parent_product_id: string
          quantity: number
          unit: string
          updated_at: string
        }
        Insert: {
          applies_to?: string[]
          component_product_id?: string | null
          component_stock_item_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_product_id: string
          quantity: number
          unit?: string
          updated_at?: string
        }
        Update: {
          applies_to?: string[]
          component_product_id?: string | null
          component_stock_item_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_product_id?: string
          quantity?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_component_stock_item_id_fkey"
            columns: ["component_stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          price: number
          product_id: string
          quantity: number
          sale_id: string
          total: number
          unit: string | null
        }
        Insert: {
          id?: string
          price: number
          product_id: string
          quantity: number
          sale_id: string
          total: number
          unit?: string | null
        }
        Update: {
          id?: string
          price?: number
          product_id?: string
          quantity?: number
          sale_id?: string
          total?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cash_paid: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          deleted_at: string | null
          delivery_address: string | null
          delivery_boy: string | null
          delivery_charges: number
          discount_amount: number
          discount_type: string
          discount_value: number
          grand_total: number
          id: string
          invoice_no: string
          katha: boolean
          online_paid: number
          order_type: string
          payment_method: string
          sale_date: string
          status: string
          whatsapp_sent_at: string | null
          whatsapp_status: string | null
        }
        Insert: {
          cash_paid?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deleted_at?: string | null
          delivery_address?: string | null
          delivery_boy?: string | null
          delivery_charges?: number
          discount_amount?: number
          discount_type?: string
          discount_value?: number
          grand_total?: number
          id?: string
          invoice_no?: string
          katha?: boolean
          online_paid?: number
          order_type?: string
          payment_method?: string
          sale_date?: string
          status?: string
          whatsapp_sent_at?: string | null
          whatsapp_status?: string | null
        }
        Update: {
          cash_paid?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deleted_at?: string | null
          delivery_address?: string | null
          delivery_boy?: string | null
          delivery_charges?: number
          discount_amount?: number
          discount_type?: string
          discount_value?: number
          grand_total?: number
          id?: string
          invoice_no?: string
          katha?: boolean
          online_paid?: number
          order_type?: string
          payment_method?: string
          sale_date?: string
          status?: string
          whatsapp_sent_at?: string | null
          whatsapp_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          allow_negative_stock: boolean
          business_day_start_time: string
          business_month_start_day: number
          id: number
          timezone: string
          updated_at: string
          whatsapp_auto_send: boolean | null
          whatsapp_business_id: string | null
          whatsapp_country_code: string | null
          whatsapp_phone_id: string | null
          whatsapp_token: string | null
        }
        Insert: {
          allow_negative_stock?: boolean
          business_day_start_time?: string
          business_month_start_day?: number
          id?: number
          timezone?: string
          updated_at?: string
          whatsapp_auto_send?: boolean | null
          whatsapp_business_id?: string | null
          whatsapp_country_code?: string | null
          whatsapp_phone_id?: string | null
          whatsapp_token?: string | null
        }
        Update: {
          allow_negative_stock?: boolean
          business_day_start_time?: string
          business_month_start_day?: number
          id?: number
          timezone?: string
          updated_at?: string
          whatsapp_auto_send?: boolean | null
          whatsapp_business_id?: string | null
          whatsapp_country_code?: string | null
          whatsapp_phone_id?: string | null
          whatsapp_token?: string | null
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          category: string
          created_at: string
          current_stock: number
          deleted_at: string | null
          id: string
          minimum_stock: number
          name: string
          notes: string | null
          opening_stock: number
          purchase_date: string | null
          purchase_price: number
          supplier_id: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          minimum_stock?: number
          name: string
          notes?: string | null
          opening_stock?: number
          purchase_date?: string | null
          purchase_price?: number
          supplier_id?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          minimum_stock?: number
          name?: string
          notes?: string | null
          opening_stock?: number
          purchase_date?: string | null
          purchase_price?: number
          supplier_id?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_purchases: {
        Row: {
          category: string
          created_at: string
          date: string
          deleted_at: string | null
          id: string
          notes: string | null
          paid_amount: number
          paid_at: string | null
          payment_source: string
          payment_status: string
          product_id: string | null
          purchase_item_id: string | null
          quantity: number
          stock_item_id: string | null
          supplier: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          category: string
          created_at?: string
          date?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_source?: string
          payment_status?: string
          product_id?: string | null
          purchase_item_id?: string | null
          quantity: number
          stock_item_id?: string | null
          supplier?: string | null
          total_cost: number
          unit_cost: number
        }
        Update: {
          category?: string
          created_at?: string
          date?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_source?: string
          payment_status?: string
          product_id?: string | null
          purchase_item_id?: string | null
          quantity?: number
          stock_item_id?: string | null
          supplier?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_purchases_purchase_item_id_fkey"
            columns: ["purchase_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_purchases_stock_item_fk"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          from_category: string
          id: string
          item_name: string
          item_type: string
          notes: string | null
          product_id: string | null
          quantity: number
          reason: string | null
          stock_item_id: string | null
          to_category: string
          total_cost: number
          unit: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          from_category: string
          id?: string
          item_name: string
          item_type: string
          notes?: string | null
          product_id?: string | null
          quantity: number
          reason?: string | null
          stock_item_id?: string | null
          to_category: string
          total_cost?: number
          unit?: string
          unit_cost?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          from_category?: string
          id?: string
          item_name?: string
          item_type?: string
          notes?: string | null
          product_id?: string | null
          quantity?: number
          reason?: string | null
          stock_item_id?: string | null
          to_category?: string
          total_cost?: number
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_stock_for_sale_item:
        | {
            Args: { _product_id: string; _quantity: number; _sign: number }
            Returns: undefined
          }
        | {
            Args: {
              _order_type?: string
              _product_id: string
              _quantity: number
              _sign: number
            }
            Returns: undefined
          }
      business_date: { Args: { ts: string }; Returns: string }
      business_date_of: { Args: { _ts: string }; Returns: string }
      category_monthly_report: {
        Args: { _month: string }
        Returns: {
          category: string
          closing_value: number
          expenses_allocated: number
          gross_profit: number
          net_profit: number
          opening_value: number
          product_purchased_value: number
          purchased_value: number
          sales_cogs: number
          sales_qty: number
          sales_revenue: number
          stock_purchased_value: number
        }[]
      }
      daily_closing_summary: { Args: { _date: string }; Returns: Json }
      dashboard_category_cards: {
        Args: never
        Returns: {
          category: string
          color: string
          icon: string
          month_cogs: number
          month_orders: number
          month_profit: number
          month_sales: number
          today_orders: number
          today_sales: number
          top_product: string
        }[]
      }
      delete_production_batch: {
        Args: { _batch_id: string }
        Returns: undefined
      }
      get_business_config: {
        Args: never
        Returns: {
          month_start_day: number
          start_time: string
          tz: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_whatsapp_status: {
        Args: { _sale_id: string; _status: string }
        Returns: undefined
      }
      monthly_financial_summary: {
        Args: { _month_start: string }
        Returns: Json
      }
      recompute_product_wac: {
        Args: { _product_id: string }
        Returns: undefined
      }
      recompute_stock_item_wac: { Args: { _id: string }; Returns: undefined }
      restore_sale_stock: { Args: { _sale_id: string }; Returns: undefined }
      save_production: {
        Args: { _notes?: string; _product_id: string; _quantity: number }
        Returns: {
          batch_date: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          notes: string | null
          product_id: string
          quantity: number
          target_category: string | null
          total_cost: number
          unit_cost: number
        }
        SetofOptions: {
          from: "*"
          to: "production_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_sale:
        | {
            Args: {
              _customer_name?: string
              _delivery_charges?: number
              _items: Json
              _payment_method?: string
              _status?: string
            }
            Returns: {
              cash_paid: number
              created_at: string
              created_by: string | null
              customer_id: string | null
              customer_name: string | null
              customer_phone: string | null
              deleted_at: string | null
              delivery_address: string | null
              delivery_boy: string | null
              delivery_charges: number
              discount_amount: number
              discount_type: string
              discount_value: number
              grand_total: number
              id: string
              invoice_no: string
              katha: boolean
              online_paid: number
              order_type: string
              payment_method: string
              sale_date: string
              status: string
              whatsapp_sent_at: string | null
              whatsapp_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _cash_paid?: number
              _customer_name?: string
              _delivery_boy?: string
              _delivery_charges?: number
              _items: Json
              _online_paid?: number
              _order_type?: string
              _payment_method?: string
              _status?: string
            }
            Returns: {
              cash_paid: number
              created_at: string
              created_by: string | null
              customer_id: string | null
              customer_name: string | null
              customer_phone: string | null
              deleted_at: string | null
              delivery_address: string | null
              delivery_boy: string | null
              delivery_charges: number
              discount_amount: number
              discount_type: string
              discount_value: number
              grand_total: number
              id: string
              invoice_no: string
              katha: boolean
              online_paid: number
              order_type: string
              payment_method: string
              sale_date: string
              status: string
              whatsapp_sent_at: string | null
              whatsapp_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _cash_paid?: number
              _customer_name?: string
              _customer_phone?: string
              _delivery_boy?: string
              _delivery_charges?: number
              _items: Json
              _katha?: boolean
              _online_paid?: number
              _order_type?: string
              _payment_method?: string
              _status?: string
            }
            Returns: {
              cash_paid: number
              created_at: string
              created_by: string | null
              customer_id: string | null
              customer_name: string | null
              customer_phone: string | null
              deleted_at: string | null
              delivery_address: string | null
              delivery_boy: string | null
              delivery_charges: number
              discount_amount: number
              discount_type: string
              discount_value: number
              grand_total: number
              id: string
              invoice_no: string
              katha: boolean
              online_paid: number
              order_type: string
              payment_method: string
              sale_date: string
              status: string
              whatsapp_sent_at: string | null
              whatsapp_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _cash_paid?: number
              _customer_name?: string
              _customer_phone?: string
              _delivery_address?: string
              _delivery_boy?: string
              _delivery_charges?: number
              _discount_type?: string
              _discount_value?: number
              _items: Json
              _katha?: boolean
              _online_paid?: number
              _order_type?: string
              _payment_method?: string
              _status?: string
            }
            Returns: {
              cash_paid: number
              created_at: string
              created_by: string | null
              customer_id: string | null
              customer_name: string | null
              customer_phone: string | null
              deleted_at: string | null
              delivery_address: string | null
              delivery_boy: string | null
              delivery_charges: number
              discount_amount: number
              discount_type: string
              discount_value: number
              grand_total: number
              id: string
              invoice_no: string
              katha: boolean
              online_paid: number
              order_type: string
              payment_method: string
              sale_date: string
              status: string
              whatsapp_sent_at: string | null
              whatsapp_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      save_stock_transfer: {
        Args: {
          _from_category: string
          _item_type: string
          _notes?: string
          _product_id: string
          _quantity: number
          _reason?: string
          _stock_item_id: string
          _to_category: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          from_category: string
          id: string
          item_name: string
          item_type: string
          notes: string | null
          product_id: string | null
          quantity: number
          reason: string | null
          stock_item_id: string | null
          to_category: string
          total_cost: number
          unit: string
          unit_cost: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_opening_stock_from_current: { Args: never; Returns: undefined }
      stock_to_expense_transfer: {
        Args: {
          _date: string
          _expense_category: string
          _notes: string
          _product_id: string
          _quantity: number
          _reason: string
          _stock_item_id: string
        }
        Returns: string
      }
      update_pending_sale:
        | {
            Args: {
              _customer_name?: string
              _delivery_charges?: number
              _items: Json
              _payment_method?: string
              _sale_id: string
              _status?: string
            }
            Returns: {
              cash_paid: number
              created_at: string
              created_by: string | null
              customer_id: string | null
              customer_name: string | null
              customer_phone: string | null
              deleted_at: string | null
              delivery_address: string | null
              delivery_boy: string | null
              delivery_charges: number
              discount_amount: number
              discount_type: string
              discount_value: number
              grand_total: number
              id: string
              invoice_no: string
              katha: boolean
              online_paid: number
              order_type: string
              payment_method: string
              sale_date: string
              status: string
              whatsapp_sent_at: string | null
              whatsapp_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _cash_paid?: number
              _customer_name?: string
              _delivery_boy?: string
              _delivery_charges?: number
              _items: Json
              _online_paid?: number
              _order_type?: string
              _payment_method?: string
              _sale_id: string
              _status?: string
            }
            Returns: {
              cash_paid: number
              created_at: string
              created_by: string | null
              customer_id: string | null
              customer_name: string | null
              customer_phone: string | null
              deleted_at: string | null
              delivery_address: string | null
              delivery_boy: string | null
              delivery_charges: number
              discount_amount: number
              discount_type: string
              discount_value: number
              grand_total: number
              id: string
              invoice_no: string
              katha: boolean
              online_paid: number
              order_type: string
              payment_method: string
              sale_date: string
              status: string
              whatsapp_sent_at: string | null
              whatsapp_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _cash_paid?: number
              _customer_name?: string
              _customer_phone?: string
              _delivery_boy?: string
              _delivery_charges?: number
              _items: Json
              _katha?: boolean
              _online_paid?: number
              _order_type?: string
              _payment_method?: string
              _sale_id: string
              _status?: string
            }
            Returns: {
              cash_paid: number
              created_at: string
              created_by: string | null
              customer_id: string | null
              customer_name: string | null
              customer_phone: string | null
              deleted_at: string | null
              delivery_address: string | null
              delivery_boy: string | null
              delivery_charges: number
              discount_amount: number
              discount_type: string
              discount_value: number
              grand_total: number
              id: string
              invoice_no: string
              katha: boolean
              online_paid: number
              order_type: string
              payment_method: string
              sale_date: string
              status: string
              whatsapp_sent_at: string | null
              whatsapp_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _cash_paid?: number
              _customer_name?: string
              _customer_phone?: string
              _delivery_address?: string
              _delivery_boy?: string
              _delivery_charges?: number
              _discount_type?: string
              _discount_value?: number
              _items: Json
              _katha?: boolean
              _online_paid?: number
              _order_type?: string
              _payment_method?: string
              _sale_id: string
              _status?: string
            }
            Returns: {
              cash_paid: number
              created_at: string
              created_by: string | null
              customer_id: string | null
              customer_name: string | null
              customer_phone: string | null
              deleted_at: string | null
              delivery_address: string | null
              delivery_boy: string | null
              delivery_charges: number
              discount_amount: number
              discount_type: string
              discount_value: number
              grand_total: number
              id: string
              invoice_no: string
              katha: boolean
              online_paid: number
              order_type: string
              payment_method: string
              sale_date: string
              status: string
              whatsapp_sent_at: string | null
              whatsapp_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      update_sale: {
        Args: {
          _cash_paid?: number
          _customer_name?: string
          _customer_phone?: string
          _delivery_address?: string
          _delivery_boy?: string
          _delivery_charges?: number
          _discount_type?: string
          _discount_value?: number
          _items: Json
          _katha?: boolean
          _online_paid?: number
          _order_type?: string
          _payment_method?: string
          _sale_date?: string
          _sale_id: string
          _status?: string
        }
        Returns: {
          cash_paid: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          deleted_at: string | null
          delivery_address: string | null
          delivery_boy: string | null
          delivery_charges: number
          discount_amount: number
          discount_type: string
          discount_value: number
          grand_total: number
          id: string
          invoice_no: string
          katha: boolean
          online_paid: number
          order_type: string
          payment_method: string
          sale_date: string
          status: string
          whatsapp_sent_at: string | null
          whatsapp_status: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_sale_payment: {
        Args: {
          _cash_paid?: number
          _customer_name?: string
          _customer_phone?: string
          _katha?: boolean
          _online_paid?: number
          _sale_id: string
        }
        Returns: {
          cash_paid: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          deleted_at: string | null
          delivery_address: string | null
          delivery_boy: string | null
          delivery_charges: number
          discount_amount: number
          discount_type: string
          discount_value: number
          grand_total: number
          id: string
          invoice_no: string
          katha: boolean
          online_paid: number
          order_type: string
          payment_method: string
          sale_date: string
          status: string
          whatsapp_sent_at: string | null
          whatsapp_status: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "staff"
      movement_type: "purchase" | "consumption" | "adjustment"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff"],
      movement_type: ["purchase", "consumption", "adjustment"],
    },
  },
} as const
