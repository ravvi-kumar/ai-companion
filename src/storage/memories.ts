import { Database as DatabaseType, Statement } from 'better-sqlite3';
import crypto from 'node:crypto';
import { MemoryCandidate, MemoryCandidateInput, MemoryCandidateSchema, MemoryClass, MemoryRecord, MemoryStatus } from '../memory/types.js';

/**
 * Raw row shape from SQLite (embedding stored as JSON text)
 */
interface MemoryRow {
  id: string;
  type: string;
  memory_class: string;
  subject: string;
  key: string;
  value: string;
  confidence: number;
  importance: number;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  embedding: string | null;
  source_message_id: string | null;
  superseded_by: string | null;
}

export class MemoryRepository {
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

  /**
   * Deserialize a raw SQLite row into a typed MemoryRecord,
   * parsing the JSON-encoded embedding back into a number array.
   */
  private deserializeRow(row: MemoryRow): MemoryRecord {
    let embedding: number[] | null = null;
    if (row.embedding) {
      try {
        embedding = JSON.parse(row.embedding);
      } catch {
        embedding = null;
      }
    }
    return {
      ...row,
      embedding
    } as MemoryRecord;
  }

  private deserializeRows(rows: MemoryRow[]): MemoryRecord[] {
    return rows.map(r => this.deserializeRow(r));
  }

  /**
   * Evaluates all ACTIVE memories against expires_at and valid_until timestamps.
   * Marks any memories past their expiration timestamp as EXPIRED.
   */
  public applyDecayAndExpiration(nowIso?: string): number {
    const now = nowIso || new Date().toISOString();
    const result = this.getStatement(`
      UPDATE memories
      SET status = 'EXPIRED', updated_at = ?
      WHERE status = 'ACTIVE'
        AND (
          (expires_at IS NOT NULL AND expires_at <= ?)
          OR
          (valid_until IS NOT NULL AND valid_until <= ?)
        )
    `).run(now, now, now);
    return result.changes;
  }

  public createMemory(
    candidate: MemoryCandidateInput,
    status: MemoryStatus = 'ACTIVE',
    sourceMessageId?: string | null,
    embedding?: number[] | null
  ): MemoryRecord {
    const parsed = MemoryCandidateSchema.parse(candidate);
    const id = `mem_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const memoryClass = parsed.memory_class || 'SEMANTIC';
    const embeddingJson = (embedding || parsed.embedding) ? JSON.stringify(embedding || parsed.embedding) : null;

    this.getStatement(`
      INSERT INTO memories (
        id, type, memory_class, subject, key, value, confidence, importance,
        status, created_at, updated_at, expires_at, valid_from, valid_until,
        embedding, source_message_id, superseded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      parsed.type,
      memoryClass,
      parsed.subject || 'user',
      parsed.key.toLowerCase().trim(),
      parsed.value.trim(),
      parsed.confidence ?? 0.9,
      parsed.importance ?? 0.5,
      status,
      now,
      now,
      parsed.expires_at || null,
      parsed.valid_from || null,
      parsed.valid_until || null,
      embeddingJson,
      sourceMessageId || null,
      null
    );

    return {
      id,
      type: parsed.type,
      memory_class: memoryClass,
      subject: parsed.subject || 'user',
      key: parsed.key.toLowerCase().trim(),
      value: parsed.value.trim(),
      confidence: parsed.confidence ?? 0.9,
      importance: parsed.importance ?? 0.5,
      status,
      created_at: now,
      updated_at: now,
      expires_at: parsed.expires_at || null,
      valid_from: parsed.valid_from || null,
      valid_until: parsed.valid_until || null,
      embedding: embedding || parsed.embedding || null,
      source_message_id: sourceMessageId || null,
      superseded_by: null
    };
  }

  /**
   * Atomically transitions an existing memory to SUPERSEDED and creates a new ACTIVE memory record.
   * Executed within a SQLite transaction to prevent partial failure states.
   */
  public supersedeMemory(
    existingId: string,
    candidate: MemoryCandidateInput,
    sourceMessageId?: string | null,
    embedding?: number[] | null
  ): { newMemory: MemoryRecord; supersededMemory: MemoryRecord } {
    const txn = this.db.transaction(() => {
      const existing = this.getMemoryById(existingId);
      if (!existing) {
        throw new Error(`Cannot supersede non-existent memory ID: ${existingId}`);
      }

      const newRecord = this.createMemory(candidate, 'ACTIVE', sourceMessageId, embedding);
      this.updateMemoryStatus(existingId, 'SUPERSEDED', newRecord.id);

      const updatedExisting = this.getMemoryById(existingId)!;
      return { newMemory: newRecord, supersededMemory: updatedExisting };
    });

    return txn();
  }

  public getActiveMemories(subject: string = 'user'): MemoryRecord[] {
    const now = new Date().toISOString();
    this.applyDecayAndExpiration(now);
    const rows = this.getStatement(`
      SELECT * FROM memories 
      WHERE subject = ? 
        AND status = 'ACTIVE'
        AND (valid_from IS NULL OR valid_from <= ?)
        AND (valid_until IS NULL OR valid_until > ?)
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY importance DESC, created_at DESC
    `).all(subject, now, now, now) as MemoryRow[];
    return this.deserializeRows(rows);
  }

  public getActiveMemoriesByClass(memoryClass: MemoryClass, subject: string = 'user'): MemoryRecord[] {
    const now = new Date().toISOString();
    this.applyDecayAndExpiration(now);
    const rows = this.getStatement(`
      SELECT * FROM memories 
      WHERE subject = ? 
        AND memory_class = ? 
        AND status = 'ACTIVE'
        AND (valid_from IS NULL OR valid_from <= ?)
        AND (valid_until IS NULL OR valid_until > ?)
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY importance DESC, created_at DESC
    `).all(subject, memoryClass, now, now, now) as MemoryRow[];
    return this.deserializeRows(rows);
  }

  public getActiveMemoryByKey(key: string, subject: string = 'user'): MemoryRecord | undefined {
    const now = new Date().toISOString();
    this.applyDecayAndExpiration(now);
    const row = this.getStatement(`
      SELECT * FROM memories 
      WHERE subject = ? 
        AND key = ? 
        AND status = 'ACTIVE'
        AND (valid_from IS NULL OR valid_from <= ?)
        AND (valid_until IS NULL OR valid_until > ?)
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC LIMIT 1
    `).get(subject, key.toLowerCase().trim(), now, now, now) as MemoryRow | undefined;
    return row ? this.deserializeRow(row) : undefined;
  }

  public getAllMemoriesByKey(key: string, subject: string = 'user'): MemoryRecord[] {
    const rows = this.getStatement('SELECT * FROM memories WHERE subject = ? AND key = ? ORDER BY created_at ASC')
      .all(subject, key.toLowerCase().trim()) as MemoryRow[];
    return this.deserializeRows(rows);
  }

  public reinforceMemory(id: string, newConfidence: number): MemoryRecord | undefined {
    const now = new Date().toISOString();
    this.getStatement('UPDATE memories SET confidence = ?, updated_at = ? WHERE id = ?')
      .run(newConfidence, now, id);
    return this.getMemoryById(id);
  }

  public updateMemoryStatus(
    id: string,
    newStatus: MemoryStatus,
    supersededBy?: string | null
  ): void {
    const now = new Date().toISOString();
    this.getStatement(`
      UPDATE memories 
      SET status = ?, superseded_by = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, supersededBy || null, now, id);
  }

  public getAllMemories(): MemoryRecord[] {
    const rows = this.getStatement('SELECT * FROM memories ORDER BY created_at DESC')
      .all() as MemoryRow[];
    return this.deserializeRows(rows);
  }

  public getMemoryById(id: string): MemoryRecord | undefined {
    const row = this.getStatement('SELECT * FROM memories WHERE id = ?')
      .get(id) as MemoryRow | undefined;
    return row ? this.deserializeRow(row) : undefined;
  }
}
