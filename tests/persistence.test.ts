import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase } from '../src/storage/database.js';
import { MessageRepository } from '../src/storage/messages.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Iteration 1: Storage & Persistence Across Sessions', () => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-companion.db');

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('persists sessions and messages across database reconnections', () => {
    // 1. First session: open DB, create session, add messages
    const db1 = new AppDatabase({ dbPath: testDbPath });
    const repo1 = new MessageRepository(db1.getRawDb());

    const session = repo1.getOrCreateSession();
    expect(session.id).toBeDefined();

    repo1.saveMessage(session.id, 'user', 'Hello Maya, I live in Bangalore.');
    repo1.saveMessage(session.id, 'assistant', "Hey! It's so nice to meet you. Bangalore is vibrant!");

    db1.close(); // Simulate app restart / shutdown

    // 2. Second session: re-open DB, query previous messages
    const db2 = new AppDatabase({ dbPath: testDbPath });
    const repo2 = new MessageRepository(db2.getRawDb());

    const resumedSession = repo2.getOrCreateSession(session.id);
    expect(resumedSession.id).toBe(session.id);

    const messages = repo2.getMessagesForSession(session.id);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello Maya, I live in Bangalore.');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toContain('Bangalore');

    db2.close();
  });

  it('lists recent sessions properly', () => {
    const db = new AppDatabase({ inMemory: true });
    const repo = new MessageRepository(db.getRawDb());

    const s1 = repo.getOrCreateSession('session_1');
    const s2 = repo.getOrCreateSession('session_2');

    const recents = repo.getRecentSessions(10);
    expect(recents.length).toBe(2);
    expect(recents.map(s => s.id)).toContain('session_1');
    expect(recents.map(s => s.id)).toContain('session_2');

    db.close();
  });
});
