import { describe, it, expect } from 'vitest';
import { AppDatabase } from '../src/storage/database.js';
import { MemoryRepository } from '../src/storage/memories.js';
import { MemoryResolver } from '../src/memory/resolver.js';
import { ChatLoop } from '../src/chat/chat-loop.js';
import { MockLLMClient, MockEmbeddingService } from './mocks/mock-llm.js';

describe('Iteration 3: Contradiction Resolution & Memory Lifecycle', () => {
  it('correctly handles state transitions from ACTIVE to SUPERSEDED', async () => {
    const db = new AppDatabase({ inMemory: true });
    const repo = new MemoryRepository(db.getRawDb());
    const llmClient = new MockLLMClient();
    const resolver = new MemoryResolver(repo, llmClient as any);

    // 1. Initial statement: user works at Microsoft
    const res1 = await resolver.resolveCandidate({
      type: 'occupation',
      subject: 'user',
      key: 'employer',
      value: 'Microsoft',
      confidence: 0.95,
      importance: 0.9
    });

    expect(res1.action).toBe('ADD');
    expect(res1.memory.status).toBe('ACTIVE');
    expect(res1.memory.value).toBe('Microsoft');

    // 2. Later statement: user joined Google
    const res2 = await resolver.resolveCandidate({
      type: 'occupation',
      subject: 'user',
      key: 'employer',
      value: 'Google',
      confidence: 0.98,
      importance: 0.9
    }, 'I left Microsoft and joined Google.');

    expect(res2.action).toBe('SUPERSEDE');
    expect(res2.memory.status).toBe('ACTIVE');
    expect(res2.memory.value).toBe('Google');
    expect(res2.superseded?.id).toBe(res1.memory.id);

    // 3. Check active memories: only Google is active
    const active = repo.getActiveMemories('user');
    expect(active.length).toBe(1);
    expect(active[0].value).toBe('Google');

    // 4. Check active memory by key
    const currentEmployer = repo.getActiveMemoryByKey('employer');
    expect(currentEmployer?.value).toBe('Google');
    expect(currentEmployer?.status).toBe('ACTIVE');

    // 5. Check full history by key: both records exist with lineage
    const history = repo.getAllMemoriesByKey('employer');
    expect(history.length).toBe(2);
    expect(history[0].value).toBe('Microsoft');
    expect(history[0].status).toBe('SUPERSEDED');
    expect(history[0].superseded_by).toBe(res2.memory.id);
    expect(history[1].value).toBe('Google');
    expect(history[1].status).toBe('ACTIVE');

    db.close();
  });

  it('reinforces existing memory confidence when confirming the same fact', async () => {
    const db = new AppDatabase({ inMemory: true });
    const repo = new MemoryRepository(db.getRawDb());
    const llmClient = new MockLLMClient();
    const resolver = new MemoryResolver(repo, llmClient as any);

    await resolver.resolveCandidate({
      type: 'preference',
      subject: 'user',
      key: 'favorite_drink',
      value: 'tea',
      confidence: 0.85,
      importance: 0.7
    });

    const res2 = await resolver.resolveCandidate({
      type: 'preference',
      subject: 'user',
      key: 'favorite_drink',
      value: 'tea',
      confidence: 0.90,
      importance: 0.7
    });

    expect(res2.action).toBe('REINFORCE');
    expect(res2.memory.confidence).toBeGreaterThan(0.85);

    const allTea = repo.getAllMemoriesByKey('favorite_drink');
    expect(allTea.length).toBe(1); // No duplicate rows created

    db.close();
  });

  it('handles multi-turn contradiction end-to-end through chat loop', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();
    const chatLoop = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });
    const repo = new MemoryRepository(db.getRawDb());

    // Turn 1
    await chatLoop.processUserMessage('I work at Microsoft as a cloud engineer.');
    let activeEmployer = repo.getActiveMemoryByKey('employer');
    expect(activeEmployer?.value).toBe('Microsoft');

    // Turn 2: contradiction / career move
    await chatLoop.processUserMessage('Big news: I left Microsoft and joined Google!');
    activeEmployer = repo.getActiveMemoryByKey('employer');
    expect(activeEmployer?.value).toBe('Google');
    expect(activeEmployer?.status).toBe('ACTIVE');

    const allEmployerRecords = repo.getAllMemoriesByKey('employer');
    expect(allEmployerRecords.length).toBe(2);
    expect(allEmployerRecords[0].status).toBe('SUPERSEDED');
    expect(allEmployerRecords[1].status).toBe('ACTIVE');

    chatLoop.close();
  });
});
