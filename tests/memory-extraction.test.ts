import { describe, it, expect } from 'vitest';
import { AppDatabase } from '../src/storage/database.js';
import { MemoryRepository } from '../src/storage/memories.js';
import { MemoryExtractor } from '../src/memory/extractor.js';
import { ChatLoop } from '../src/chat/chat-loop.js';
import { MemoryCandidateSchema } from '../src/memory/types.js';
import { MockLLMClient, MockEmbeddingService } from './mocks/mock-llm.js';

describe('Iteration 2: Memory Extraction & Structured Storage', () => {
  it('validates memory candidates strictly with Zod schema', () => {
    const validCandidate = {
      type: 'occupation',
      subject: 'user',
      key: 'employer',
      value: 'Google',
      confidence: 0.95,
      importance: 0.9
    };

    const parseResult = MemoryCandidateSchema.safeParse(validCandidate);
    expect(parseResult.success).toBe(true);

    const invalidCandidate = {
      type: 'invalid_type_name',
      key: '',
      value: 'Google'
    };

    const invalidResult = MemoryCandidateSchema.safeParse(invalidCandidate);
    expect(invalidResult.success).toBe(false);
  });

  it('extracts structured facts from user disclosures', async () => {
    const llmClient = new MockLLMClient();
    const extractor = new MemoryExtractor(llmClient as any);

    const candidates = await extractor.extract({
      userMessage: 'I work at Google as a senior backend engineer.'
    });

    expect(candidates.length).toBeGreaterThan(0);
    const employerMem = candidates.find(c => c.key === 'employer');
    expect(employerMem).toBeDefined();
    expect(employerMem?.value).toBe('Google');
    expect(employerMem?.type).toBe('occupation');
  });

  it('does not extract memories from trivial greetings or small talk', async () => {
    const llmClient = new MockLLMClient();
    const extractor = new MemoryExtractor(llmClient as any);

    const candidates = await extractor.extract({
      userMessage: 'hello there! How are you doing today?'
    });

    expect(candidates.length).toBe(0);
  });

  it('stores and retrieves memories in MemoryRepository with ACTIVE status', () => {
    const db = new AppDatabase({ inMemory: true });
    const repo = new MemoryRepository(db.getRawDb());

    const mem = repo.createMemory({
      type: 'location',
      subject: 'user',
      key: 'city',
      value: 'Bangalore',
      confidence: 0.95,
      importance: 0.85
    });

    expect(mem.id).toMatch(/^mem_/);
    expect(mem.status).toBe('ACTIVE');

    const activeList = repo.getActiveMemories('user');
    expect(activeList.length).toBe(1);
    expect(activeList[0].key).toBe('city');
    expect(activeList[0].value).toBe('Bangalore');

    const single = repo.getActiveMemoryByKey('city');
    expect(single).toBeDefined();
    expect(single?.value).toBe('Bangalore');

    db.close();
  });

  it('learns and persists memory end-to-end during interactive chat turns', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();
    const chatLoop = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });
    const memoryRepo = new MemoryRepository(db.getRawDb());

    await chatLoop.processUserMessage('I recently moved and now I live in Bangalore.');

    const activeMemories = memoryRepo.getActiveMemories('user');
    expect(activeMemories.length).toBeGreaterThan(0);

    const cityMem = memoryRepo.getActiveMemoryByKey('city');
    expect(cityMem).toBeDefined();
    expect(cityMem?.value).toBe('Bangalore');

    chatLoop.close();
  });
});
