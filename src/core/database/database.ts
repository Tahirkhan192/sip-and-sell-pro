export class Database {
  private static instance: Database;

  private constructor() {}

  static async getInstance() {
    if (!Database.instance) {
      Database.instance = new Database();
      console.log("Local Database Engine Ready");
    }

    return Database.instance;
  }

  async query(sql: string, params: any[] = []) {
    console.log("SQL:", sql, params);

    return [];
  }

  async execute(sql: string, params: any[] = []) {
    console.log("EXECUTE:", sql, params);

    return true;
  }
}

export async function initializeDatabase() {
  return Database.getInstance();
}