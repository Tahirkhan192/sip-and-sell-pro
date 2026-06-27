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
      categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
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
      delivery_expenses: {
        Row: {
          created_at: string
          date: string
          deleted_at: string | null
          description: string | null
          fuel_cost: number
          id: string
          maintenance_cost: number
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
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          deleted_at: string | null
          description: string | null
          id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          date?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
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
      products: {
        Row: {
          active: boolean
          category: string
          cost_price: number
          created_at: string
          current_stock: number
          deleted_at: string | null
          id: string
          minimum_stock: number
          name: string
          opening_stock: number
          sale_price: number
        }
        Insert: {
          active?: boolean
          category: string
          cost_price?: number
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          minimum_stock?: number
          name: string
          opening_stock?: number
          sale_price?: number
        }
        Update: {
          active?: boolean
          category?: string
          cost_price?: number
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          minimum_stock?: number
          name?: string
          opening_stock?: number
          sale_price?: number
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          id: string
          price: number
          product_id: string
          quantity: number
          sale_id: string
          total: number
        }
        Insert: {
          id?: string
          price: number
          product_id: string
          quantity: number
          sale_id: string
          total: number
        }
        Update: {
          id?: string
          price?: number
          product_id?: string
          quantity?: number
          sale_id?: string
          total?: number
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
          created_at: string
          created_by: string | null
          customer_name: string | null
          deleted_at: string | null
          delivery_charges: number
          grand_total: number
          id: string
          invoice_no: string
          payment_method: string
          sale_date: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          deleted_at?: string | null
          delivery_charges?: number
          grand_total?: number
          id?: string
          invoice_no?: string
          payment_method?: string
          sale_date?: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          deleted_at?: string | null
          delivery_charges?: number
          grand_total?: number
          id?: string
          invoice_no?: string
          payment_method?: string
          sale_date?: string
          status?: string
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          created_at: string
          current_stock: number
          deleted_at: string | null
          id: string
          minimum_stock: number
          name: string
          opening_stock: number
          purchase_price: number
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          minimum_stock?: number
          name: string
          opening_stock?: number
          purchase_price?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          minimum_stock?: number
          name?: string
          opening_stock?: number
          purchase_price?: number
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
          product_id: string | null
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
          product_id?: string | null
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
          product_id?: string | null
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
            foreignKeyName: "stock_purchases_stock_item_fk"
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
      business_date: { Args: { ts: string }; Returns: string }
      category_monthly_report: {
        Args: { _month: string }
        Returns: {
          category: string
          closing_value: number
          expenses_allocated: number
          gross_profit: number
          net_profit: number
          opening_value: number
          purchased_value: number
          sales_cogs: number
          sales_qty: number
          sales_revenue: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      restore_sale_stock: { Args: { _sale_id: string }; Returns: undefined }
      save_sale: {
        Args: {
          _customer_name?: string
          _delivery_charges?: number
          _items: Json
          _payment_method?: string
          _status?: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          customer_name: string | null
          deleted_at: string | null
          delivery_charges: number
          grand_total: number
          id: string
          invoice_no: string
          payment_method: string
          sale_date: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_pending_sale: {
        Args: {
          _customer_name?: string
          _delivery_charges?: number
          _items: Json
          _payment_method?: string
          _sale_id: string
          _status?: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          customer_name: string | null
          deleted_at: string | null
          delivery_charges: number
          grand_total: number
          id: string
          invoice_no: string
          payment_method: string
          sale_date: string
          status: string
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
