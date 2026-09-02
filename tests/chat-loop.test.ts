import { describe, it, expect } from 'vitest';
import { AppDatabase } from '../src/storage/database.js';
import { ChatLoop } from '../src/chat/chat-loop.js';
import { MockLLMClient, MockEmbeddingService } from './mocks/mock-llm.js';

describe('Iteration 1: Interactive Chat Loop & Persona Generation', () => {
  it('generates a persona-consistent reply and saves conversation turns', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();
    const chatLoop = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });

    const reply1 = await chatLoop.processUserMessage('Hello Maya, tell me about yourself!');
    expect(reply1).toBeDefined();
    expect(reply1.length).toBeGreaterThan(10);
    expect(reply1.toLowerCase()).toMatch(/maya|coastal|photography|film|tea|jasmine|books/i);

    const reply2 = await chatLoop.processUserMessage('What are your hobbies?');
    expect(reply2).toBeDefined();
    expect(reply2.toLowerCase()).toMatch(/film photography|tea|walks|camera|plants|books/i);

    chatLoop.close();
  });
});
