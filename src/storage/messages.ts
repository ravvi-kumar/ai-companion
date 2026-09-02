import { Database as DatabaseType, Statement } from 'better-sqlite3';
import crypto from 'node:crypto';

export interface SessionRecord {
  id: string;
  created_at: string;
  last_active_at: string;
}

export interface MessageRecord {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export class MessageRepository {
  private db: DatabaseType;
  private stmtCache = new Map<string, Statement>();

  constructor(db: DatabaseType) {
    this.db = db;
  }

  private getStatement(sql: string): Statement {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  public getOrCreateSession(sessionId?: string): SessionRecord {
    const now = new Date().toISOString();
    if (sessionId) {
      const existing = this.getStatement('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRecord | undefined;
      if (existing) {
        this.getStatement('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(now, sessionId);
        return { ...existing, last_active_at: now };
      }
    }

    const newId = sessionId || `sess_${crypto.randomUUID()}`;
    this.getStatement('INSERT INTO sessions (id, created_at, last_active_at) VALUES (?, ?, ?)').run(newId, now, now);

    return { id: newId, created_at: now, last_active_at: now };
  }

  public getRecentSessions(limit = 5): SessionRecord[] {
    return this.getStatement('SELECT * FROM sessions ORDER BY last_active_at DESC LIMIT ?').all(limit) as SessionRecord[];
  }

  public saveMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): MessageRecord {
    const now = new Date().toISOString();
    const id = `msg_${crypto.randomUUID()}`;
    this.getStatement('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(id, sessionId, role, content, now);
    this.getStatement('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(now, sessionId);

    return { id, session_id: sessionId, role, content, created_at: now };
  }

  public getMessagesForSession(sessionId: string, limit = 50): MessageRecord[] {
    return this.getStatement(`
      SELECT id, session_id, role, content, created_at FROM (
        SELECT rowid as r_id, id, session_id, role, content, created_at FROM messages 
        WHERE session_id = ? 
        ORDER BY created_at DESC, r_id DESC 
        LIMIT ?
      ) ORDER BY created_at ASC, r_id ASC
    `).all(sessionId, limit) as MessageRecord[];
  }

  public getRecentMessages(limit = 10): MessageRecord[] {
    const messages = this.getStatement('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?').all(limit) as MessageRecord[];
    return messages.reverse();
  }

  public clearSession(sessionId: string): void {
    this.getStatement('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.getStatement('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }
}
