import { describe, it, expect } from 'vitest';
import { AppDatabase } from '../src/storage/database.js';
import { MemoryRepository } from '../src/storage/memories.js';
import { MemoryExtractor } from '../src/memory/extractor.js';
import { MemoryRetriever } from '../src/memory/retriever.js';
import { ChatLoop } from '../src/chat/chat-loop.js';
import { MockLLMClient, MockEmbeddingService } from './mocks/mock-llm.js';

describe('3-Tier Memory System (Working, Episodic, Semantic) & Decay', () => {
  it('extracts working memory for acute health states and temporary symptoms', async () => {
    const llmClient = new MockLLMClient();
    const extractor = new MemoryExtractor(llmClient as any);

    const candidates = await extractor.extract({
      userMessage: 'i am having a back pain since this morning'
    });

    expect(candidates.length).toBeGreaterThan(0);
    const healthCandidate = candidates.find(c => c.key === 'current_health_issue' || c.type === 'health');
    expect(healthCandidate).toBeDefined();
    expect(healthCandidate?.memory_class).toBe('WORKING');
    expect(healthCandidate?.value).toContain('back pain');
    expect(healthCandidate?.expires_at).toBeDefined();
  });

  it('Test A (Same-session context): remembers back pain within the same session', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();
    const chatLoop = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });

    await chatLoop.processUserMessage('i am having a back pain since this morning');

    const reply = await chatLoop.processUserMessage('why am i not feeling great?');
    expect(reply.toLowerCase()).toContain('back pain');

    chatLoop.close();
  });

  it('Test B (Cross-session episodic memory): retrieves recent episodic/working context in a new session', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();

    // Session 1: User mentions back pain
    const session1Chat = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });
    await session1Chat.processUserMessage('i am having a back pain since this morning');
    const sess1Id = session1Chat.getSessionId();

    // Session 2: Fresh session ID (simulating application restart or new session)
    const session2Chat = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });
    expect(session2Chat.getSessionId()).not.toBe(sess1Id);

    const reply = await session2Chat.processUserMessage('not great, do you know why?');
    expect(reply.toLowerCase()).toContain('back pain');

    session1Chat.close();
    session2Chat.close();
  });

  it('Test C (Long-term semantic persistence): persists durable facts across sessions', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();

    // Session 1: User discloses pet name
    const session1Chat = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });
    await session1Chat.processUserMessage("My dog's name is Max.");

    // Session 2: New session
    const session2Chat = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });
    const reply = await session2Chat.processUserMessage('What is my dog name?');
    expect(reply).toContain('Max');

    session1Chat.close();
    session2Chat.close();
  });

  it('Test D (Decay & Expiration): expires temporary memories when expires_at has passed', async () => {
    const db = new AppDatabase({ inMemory: true });
    const repo = new MemoryRepository(db.getRawDb());
    const embeddings = new MockEmbeddingService();
    const retriever = new MemoryRetriever(repo, embeddings as any);

    // Create a temporary plan memory that expired 1 hour ago
    const pastTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    repo.createMemory({
      type: 'plan',
      memory_class: 'EPISODIC',
      subject: 'user',
      key: 'upcoming_meeting',
      value: 'meeting with team on project sync',
      expires_at: pastTimestamp
    });

    // Create a durable semantic memory with no expiration
    repo.createMemory({
      type: 'occupation',
      memory_class: 'SEMANTIC',
      subject: 'user',
      key: 'employer',
      value: 'Google',
      expires_at: null
    });

    // Trigger decay evaluation
    const expiredCount = repo.applyDecayAndExpiration();
    expect(expiredCount).toBe(1);

    const activeMemories = repo.getActiveMemories('user');
    expect(activeMemories.length).toBe(1);
    expect(activeMemories[0].key).toBe('employer');

    // Retrieval query should not return the expired meeting
    const retrieved = await retriever.retrieve({ query: 'meeting schedule' });
    const hasExpiredMeeting = retrieved.some(r => r.memory.key === 'upcoming_meeting');
    expect(hasExpiredMeeting).toBe(false);

    db.close();
  });

  it('separates active memories by tier in MemoryRepository', () => {
    const db = new AppDatabase({ inMemory: true });
    const repo = new MemoryRepository(db.getRawDb());

    repo.createMemory({
      type: 'health',
      memory_class: 'WORKING',
      subject: 'user',
      key: 'current_health_issue',
      value: 'back pain'
    });

    repo.createMemory({
      type: 'plan',
      memory_class: 'EPISODIC',
      subject: 'user',
      key: 'upcoming_meeting',
      value: 'meeting tomorrow at 10 AM'
    });

    repo.createMemory({
      type: 'location',
      memory_class: 'SEMANTIC',
      subject: 'user',
      key: 'city',
      value: 'Bangalore'
    });

    const working = repo.getActiveMemoriesByClass('WORKING');
    expect(working.length).toBe(1);
    expect(working[0].key).toBe('current_health_issue');

    const episodic = repo.getActiveMemoriesByClass('EPISODIC');
    expect(episodic.length).toBe(1);
    expect(episodic[0].key).toBe('upcoming_meeting');

    const semantic = repo.getActiveMemoriesByClass('SEMANTIC');
    expect(semantic.length).toBe(1);
    expect(semantic[0].key).toBe('city');

    db.close();
  });
});
