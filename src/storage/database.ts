import DatabaseConstructor, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DatabaseConfig {
  dbPath?: string;
  inMemory?: boolean;
}

export class AppDatabase {
  private db: DatabaseType;

  constructor(config: DatabaseConfig = {}) {
    if (config.inMemory) {
      this.db = new DatabaseConstructor(':memory:');
    } else {
      const dbPath = config.dbPath || env.DATABASE_PATH || './data/companion.db';
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new DatabaseConstructor(dbPath);
    }

    // Enable WAL mode and foreign keys for reliability and concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.migrate();
  }

  private migrate(): void {
    const schemaPath = path.resolve(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const ddl = fs.readFileSync(schemaPath, 'utf-8');
      this.db.exec(ddl);
    } else {
      // Inline fallback if schema.sql isn't found at runtime
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          last_active_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          memory_class TEXT NOT NULL DEFAULT 'SEMANTIC' CHECK (memory_class IN ('WORKING', 'EPISODIC', 'SEMANTIC')),
          subject TEXT NOT NULL DEFAULT 'user',
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          importance REAL NOT NULL DEFAULT 0.5,
          status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'EXPIRED', 'DISCARDED')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT,
          valid_from TEXT,
          valid_until TEXT,
          embedding TEXT,
          source_message_id TEXT,
          superseded_by TEXT,
          FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL,
          FOREIGN KEY (superseded_by) REFERENCES memories(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_memories_subject_key ON memories(subject, key);
        CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
        CREATE INDEX IF NOT EXISTS idx_memories_class_status ON memories(memory_class, status, expires_at);
      `);
    }

    // Dynamic schema evolution for existing databases:
    try {
      const columns = this.db.pragma('table_info(memories)') as Array<{ name: string }>;
      const columnNames = new Set(columns.map(c => c.name));

      if (!columnNames.has('memory_class')) {
        this.db.exec("ALTER TABLE memories ADD COLUMN memory_class TEXT NOT NULL DEFAULT 'SEMANTIC'");
      }
      if (!columnNames.has('expires_at')) {
        this.db.exec("ALTER TABLE memories ADD COLUMN expires_at TEXT");
      }
      if (!columnNames.has('embedding')) {
        this.db.exec("ALTER TABLE memories ADD COLUMN embedding TEXT");
      }
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_class_status ON memories(memory_class, status, expires_at)");
    } catch {
      // Ignore if table doesn't exist yet (handled by DDL)
    }
  }

  public getRawDb(): DatabaseType {
    return this.db;
  }

  public close(): void {
    this.db.close();
  }
}
