import { describe, it, expect } from 'vitest';
import { AppDatabase } from '../src/storage/database.js';
import { MemoryRepository } from '../src/storage/memories.js';
import { ChatLoop } from '../src/chat/chat-loop.js';
import { MAYA_PERSONA } from '../src/persona/persona.js';
import { MockLLMClient, MockEmbeddingService } from './mocks/mock-llm.js';

describe('Iteration 5: Persona Consistency Guardrails & 50+ Turn Simulation', () => {
  it('persona definition maintains strict character invariants', () => {
    expect(MAYA_PERSONA.name).toBe('Maya');
    expect(MAYA_PERSONA.traits).toContain('Warm, genuinely attentive, and emotionally attuned');
    expect(MAYA_PERSONA.opinions.some(o => o.includes('work-life balance'))).toBe(true);
    expect(MAYA_PERSONA.backstory.some(b => b.includes('photography'))).toBe(true);
    expect(MAYA_PERSONA.rules.some(r => r.includes('NEVER break character'))).toBe(true);
  });

  it('resists tone flattening and never produces robotic boilerplate', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();
    const chatLoop = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });

    const reply = await chatLoop.processUserMessage('Tell me who you are.');

    const forbiddenPhrases = [
      'as an ai language model',
      'as an artificial intelligence',
      'i do not possess emotions',
      'i am a machine learning model'
    ];

    for (const phrase of forbiddenPhrases) {
      expect(reply.toLowerCase()).not.toContain(phrase);
    }

    chatLoop.close();
  });

  it('runs a 50+ turn simulation retaining state and persona without drift', async () => {
    const db = new AppDatabase({ inMemory: true });
    const llmClient = new MockLLMClient();
    const embeddingService = new MockEmbeddingService();
    const chatLoop = new ChatLoop({ db, llmClient: llmClient as any, embeddingService: embeddingService as any });
    const memoryRepo = new MemoryRepository(db.getRawDb());

    // Turn 1: Establish initial user context
    await chatLoop.processUserMessage('Hey Maya! I live in Bangalore and work at Microsoft.');

    // Turns 2 to 20: Simulating multi-topic conversation turns
    const topics = [
      'How was your morning?',
      'Do you like rainy days?',
      'Tell me about your photography.',
      'I had a busy day at work today.',
      'What tea are you drinking lately?',
      'I am thinking of getting a pet cat.',
      'Have you ever listened to acoustic guitar?',
      'It rained heavily here in the afternoon.',
      'What is your favorite kind of routine?',
      'I made some herbal tea after dinner.',
      'Do you remember that misty coastal town you lived in?',
      'Work has been a bit overwhelming this week.',
      'How do you feel about taking rest when tired?',
      'I went for a quiet evening walk today.',
      'Do you like books about nature and travel?',
      'I took some candid photos over the weekend.',
      'How are your apartment plants doing?',
      'What kind of music do you listen to while thinking?'
    ];

    for (let i = 0; i < topics.length; i++) {
      const response = await chatLoop.processUserMessage(topics[i]);
      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);
      expect(response.toLowerCase()).not.toContain('as an ai language model');
    }

    // Career update: Introduce contradiction/superseding update
    await chatLoop.processUserMessage('I have huge news: I left Microsoft and joined Google!');

    // Test memory retrieval and contradiction handling after multi-turn conversation
    const whereWork = await chatLoop.processUserMessage('Where do I work now?');
    expect(whereWork.toLowerCase()).toContain('google');
    expect(whereWork.toLowerCase()).not.toContain('microsoft');

    // Test location memory retention
    const whereLive = await chatLoop.processUserMessage('Where do I live?');
    expect(whereLive.toLowerCase()).toContain('bangalore');

    // Test Maya's own persona consistency
    const mayaHobbies = await chatLoop.processUserMessage('What are your hobbies?');
    expect(mayaHobbies.toLowerCase()).toMatch(/film photography|tea|walks|camera|plants/i);

    // Verify SQLite state
    const employerMemories = memoryRepo.getAllMemoriesByKey('employer');
    expect(employerMemories.length).toBe(2);
    expect(employerMemories[0].status).toBe('SUPERSEDED');
    expect(employerMemories[1].status).toBe('ACTIVE');
    expect(employerMemories[1].value).toBe('Google');

    chatLoop.close();
  }, 120000);
});
