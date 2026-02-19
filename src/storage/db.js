import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DatabaseError, retryOperation } from "../utils/errors.js";
import config from "../utils/config.js";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function initMemoryDb(db) {
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT 'default',
        content TEXT NOT NULL,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        expires_at TEXT,
        project_id TEXT NOT NULL DEFAULT 'legacy'
      );
    `);

    const cols = db.prepare("PRAGMA table_info(memory)").all();
    const colNames = new Set(cols.map((c) => c?.name));

    if (!colNames.has("scope")) {
      db.exec("ALTER TABLE memory ADD COLUMN scope TEXT NOT NULL DEFAULT 'default'");
    }
    if (!colNames.has("project_id")) {
      db.exec("ALTER TABLE memory ADD COLUMN project_id TEXT NOT NULL DEFAULT 'legacy'");
    }
    if (!colNames.has("updated_at")) {
      db.exec("ALTER TABLE memory ADD COLUMN updated_at TEXT");
    }
    if (!colNames.has("expires_at")) {
      db.exec("ALTER TABLE memory ADD COLUMN expires_at TEXT");
    }

    db.exec("CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_memory_scope_created_at ON memory(scope, created_at)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_memory_project_id ON memory(project_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_memory_project_id_created_at ON memory(project_id, created_at)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_memory_expires_at ON memory(expires_at)");

    // FTS5 virtual table for memory full-text search (P4)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        tags
      );
    `);

    // Sync existing rows into FTS if empty
    const ftsCount = db.prepare("SELECT count(*) as c FROM memory_fts").get();
    const memCount = db.prepare("SELECT count(*) as c FROM memory").get();
    if (ftsCount.c === 0 && memCount.c > 0) {
      db.exec(`
        INSERT INTO memory_fts(rowid, content, tags)
        SELECT rowid, content, COALESCE(tags, '') FROM memory
      `);
    }
  } catch (error) {
    throw new DatabaseError("Failed to initialize memory database", error);
  }
}

function initKbDb(db) {
  try {
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
        title,
        content,
        source
      );
    `);

    // Project-scoped KB table (P5)
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_meta (
        rowid INTEGER PRIMARY KEY,
        project_id TEXT DEFAULT NULL
      );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_kb_meta_project_id ON kb_meta(project_id)");
  } catch (error) {
    throw new DatabaseError("Failed to initialize KB database", error);
  }
}

function openDatabaseWithRetry(dbPath) {
  try {
    const db = new Database(dbPath, { timeout: config.dbTimeout });
    return db;
  } catch (error) {
    throw new DatabaseError(`Failed to open database: ${dbPath}`, error);
  }
}

export function openDatabases({ dataDir }) {
  ensureDir(dataDir);

  const memoryPath = path.join(dataDir, "memory.sqlite");
  const kbPath = path.join(dataDir, "kb.sqlite");

  try {
    const memoryDb = openDatabaseWithRetry(memoryPath);
    const kbDb = openDatabaseWithRetry(kbPath);

    initMemoryDb(memoryDb);
    initKbDb(kbDb);

    return {
      memoryDb,
      kbDb,
      close() {
        try {
          memoryDb.close();
        } catch (error) {
          throw new DatabaseError("Failed to close memory database", error);
        } finally {
          try {
            kbDb.close();
          } catch (error) {
            throw new DatabaseError("Failed to close KB database", error);
          }
        }
      }
    };
  } catch (error) {
    throw new DatabaseError("Failed to initialize databases", error);
  }
}
