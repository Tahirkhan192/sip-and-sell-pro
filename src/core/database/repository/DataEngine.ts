import { supabase } from "@/integrations/supabase/client";
import { initializeDatabase } from "./database";

export class DataEngine {
  private static instance: DataEngine;

  private constructor() {}

  static getInstance() {
    if (!DataEngine.instance) {
      DataEngine.instance = new DataEngine();
    }
    return DataEngine.instance;
  }

  async getDatabase() {
    return await initializeDatabase();
  }

  getSupabase() {
    return supabase;
  }

  async isOnline(): Promise<boolean> {
    return navigator.onLine;
  }
}

export const dataEngine = DataEngine.getInstance();