import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MANAJERKU_SQL_DDL } from "./schema.ts";
import { seedInitialOrienixData } from "./seed.ts";

let globalDbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

/**
 * Returns the active relational database instance with foreign keys and WAL mode enabled.
 * Supports isolated test databases via setDatabasePathForTesting().
 */
export function getDb(): DatabaseSync {
  const targetPath =
    process.env.MANAJERKU_DB_PATH ||
    path.join(process.cwd(), ".data", "manajerku.db");

  if (globalDbInstance && currentDbPath === targetPath) {
    if (process.env.MANAJERKU_SKIP_DEFAULT_SEED !== "1") {
      const defaultStore = globalDbInstance
        .prepare("SELECT id FROM stores WHERE id = 'store-orienix-01'")
        .get() as { id: string } | undefined;
      if (!defaultStore) {
        seedInitialOrienixData(globalDbInstance);
      }
    }
    return globalDbInstance;
  }

  if (targetPath !== ":memory:") {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (targetPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }

  db.exec(MANAJERKU_SQL_DDL);

  // Ensure smooth column migration if an older local .db file exists on disk
  const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{
    name: string;
  }>;
  const colNames = new Set(userCols.map((c) => c.name));
  if (!colNames.has("email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT;");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);",
    );
  }
  if (!colNames.has("password_hash")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';",
    );
  }
  if (!colNames.has("password_salt")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN password_salt TEXT NOT NULL DEFAULT '';",
    );
  }
  if (!colNames.has("account_status")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'ACTIVE';",
    );
  }

  const storeCols = db.prepare("PRAGMA table_info(stores)").all() as Array<{
    name: string;
  }>;
  const storeColNames = new Set(storeCols.map((c) => c.name));
  if (!storeColNames.has("qris_image_data_url")) {
    db.exec("ALTER TABLE stores ADD COLUMN qris_image_data_url TEXT;");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS playwright_scrape_runs (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      search_query TEXT NOT NULL,
      raw_keyword TEXT NOT NULL,
      location_hint TEXT,
      rfq_code TEXT,
      results_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  globalDbInstance = db;
  currentDbPath = targetPath;

  // Seed default Orienix baseline store if 'store-orienix-01' does not exist or needs credential upgrade
  if (process.env.MANAJERKU_SKIP_DEFAULT_SEED !== "1") {
    const defaultStore = db
      .prepare("SELECT id FROM stores WHERE id = 'store-orienix-01'")
      .get() as { id: string } | undefined;
    const ownerRow = db
      .prepare("SELECT password_hash FROM users WHERE id = 'user-owner-01'")
      .get() as { password_hash: string } | undefined;

    if (!defaultStore || !ownerRow || !ownerRow.password_hash) {
      seedInitialOrienixData(db);
    }
  }

  return db;
}

/**
 * Resets and re-initializes the database for deterministic testing.
 */
export function resetTestDatabase(seedBaseline = true): DatabaseSync {
  if (globalDbInstance) {
    try {
      globalDbInstance.close();
    } catch {
      // ignore close errors
    }
    globalDbInstance = null;
  }
  process.env.MANAJERKU_DB_PATH = ":memory:";
  process.env.MANAJERKU_SKIP_DEFAULT_SEED = seedBaseline ? "0" : "1";
  return getDb();
}

/**
 * Executes a synchronous callback inside an atomic ACID database transaction (BEGIN IMMEDIATE ... COMMIT/ROLLBACK).
 */
export function runAtomicTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
    const result = fn(db);
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore rollback secondary error
    }
    throw error;
  }
}
