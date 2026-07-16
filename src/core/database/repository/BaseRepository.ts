import { dataEngine } from "./DataEngine";

export abstract class BaseRepository<T> {
  protected async db() {
    return await dataEngine.getDatabase();
  }

  protected async execute(sql: string, params: any[] = []) {
    const db = await this.db();
    return db.execute(sql, params);
  }

  protected async query(sql: string, params: any[] = []) {
    const db = await this.db();
    return db.query(sql, params);
  }

  protected async online() {
    return await dataEngine.isOnline();
  }

  protected get supabase() {
    return dataEngine.getSupabase();
  }
}