import { describe, it, expect } from 'vitest';
import { AppDatabase } from '../src/storage/database.js';
import { MemoryRepository } from '../src/storage/memories.js';
import { MemoryRetriever } from '../src/memory/retriever.js';
import { ChatLoop } from '../src/chat/chat-loop.js';
import { MockLLMClient, MockEmbeddingService } from './mocks/mock-llm.js';

describe('Iteration 4: Hybrid Memory Retrieval & Context Assembly', () => {
  it('computes cosine similarity accurately on normalized vectors', () => {
    const embeddingService = new MockEmbeddingService();

    const v1 = [1, 0, 0, 0];
    const v2 = [0.8, 0.6, 0, 0];
    const v3 = [0, 1, 0, 0];

    const sim1_2 = embeddingService.cosineSimilarity(v1, v2);
    const sim1_3 = embeddingService.cosineSimilarity(v1, v3);

    expect(sim1_2).toBeCloseTo(0.8, 2);
    expect(sim1_3).toBe(0);
    expect(sim1_2).toBeGreaterThan(sim1_3);
  });

  it('ranks query-relevant active memories at the top and ignores superseded ones', async () => {
    const db = new AppDatabase({ inMemory: true });
    const repo = new MemoryRepository(db.getRawDb());
    const embeddings = new MockEmbeddingService();
    const retriever = new MemoryRetriever(repo, embeddings as any);

    // Create several memories
    const memOldEmployer = repo.createMemory({
      type: 'occupation',
      subject: 'user',
      key: 'employer',
      value: 'Microsoft',
      confidence: 0.9,
      importance: 0.8
    }, 'SUPERSEDED');

    const memNewEmployer = repo.createMemory({
      type: 'occupation',
      subject: 'user',
      key: 'employer',
      value: 'Google',
      confidence: 0.95,
      importance: 0.9
    }, 'ACTIVE');

    const memDrink = repo.createMemory({
      type: 'preference',
      subject: 'user',
      key: 'favorite_drink',
      value: 'tea',
      confidence: 0.9,
      importance: 0.7
    }, 'ACTIVE');

    const memCity = repo.createMemory({
      type: 'location',
      subject: 'user',
      key: 'city',
      value: 'Bangalore',
      confidence: 0.9,
      importance: 0.75
    }, 'ACTIVE');

    // Query for employer
    const results = await retriever.retrieve({
      query: 'Who is my current employer?',
      limit: 3
    });

    expect(results.length).toBeGreaterThan(0);
    // Active Google employer must be recalled
    const topResult = results[0];
    expect(topResult.memory.key).toBe('employer');
    expect(topResult.memory.value).toBe('Google');
    expect(topResult.memory.status).toBe('ACTIVE');

    // Superseded Microsoft must NOT appear in results
    const foundOld = results.find(r => r.memory.value === 'Microsoft');
    expect(foundOld).toBeUndefined();

    db.close();
  });

  it('recalls relevant facts across sessions during chat turns', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();
    const chatLoop = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });

    // Turn 1: user discloses employer
    await chatLoop.processUserMessage('I work at Google as a staff engineer.');

    // Turn 2: user asks a question relying on memory recall
    const answer = await chatLoop.processUserMessage('Where do I work?');
    expect(answer.toLowerCase()).toContain('google');

    chatLoop.close();
  });
});
