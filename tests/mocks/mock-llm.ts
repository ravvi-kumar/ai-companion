import { LLMGenerateOptions, LLMMessage } from '../../src/llm/client.js';
import { MemoryCandidate } from '../../src/memory/types.js';

export class MockLLMClient {
  private model: string = 'mock-gpt-4o-mini';
  public customHandler?: (options: LLMGenerateOptions) => Promise<string> | string;
  public generateCalls: LLMGenerateOptions[] = [];

  public getModel(): string {
    return this.model;
  }

  public async generate(options: LLMGenerateOptions): Promise<string> {
    this.generateCalls.push(options);

    if (this.customHandler) {
      return this.customHandler(options);
    }

    const systemMsg = options.messages.find(m => m.role === 'system')?.content || '';
    const userMsg = options.messages.find(m => m.role === 'user')?.content || '';

    // 1. Mock Structured Memory Extraction
    if (systemMsg.includes('Memory Extraction') || systemMsg.includes('extract structured memories')) {
      const extracted = this.mockExtraction(userMsg);
      return JSON.stringify({ memories: extracted });
    }

    // 2. Mock Contradiction Resolution Classification
    if (systemMsg.includes('Memory Contradiction Resolver')) {
      if (userMsg.toLowerCase().includes('google') && userMsg.toLowerCase().includes('microsoft')) {
        return JSON.stringify({ relationship: 'SUPERSEDES', reason: 'Career update from Microsoft to Google' });
      }
      if (userMsg.toLowerCase().includes('single') || userMsg.toLowerCase().includes('broke up')) {
        return JSON.stringify({ relationship: 'SUPERSEDES', reason: 'Relationship status changed to single' });
      }
      if (userMsg.toLowerCase().includes('ignore_this_update') || userMsg.toLowerCase().includes('ignore candidate') || userMsg.toLowerCase().includes('ignore')) {
        return JSON.stringify({ relationship: 'IGNORE', reason: 'Redundant statement discarded' });
      }
      return JSON.stringify({ relationship: 'ADDITIONAL', reason: 'Coexisting fact' });
    }

    // 3. Mock LLM Evaluation Judge
    if (systemMsg.includes('AI Companion evaluation judge')) {
      return JSON.stringify({
        memory_recall: 1.0,
        stale_avoidance: 1.0,
        persona_consistency: 1.0,
        naturalness: 1.0,
        overall: 1.0,
        reasoning: 'Mock evaluation passed with flying colors.'
      });
    }

    // 4. Default Mock Persona Chat Response
    return this.mockChatReply(options.messages);
  }

  public async *stream(options: LLMGenerateOptions): AsyncGenerator<string, void, unknown> {
    const full = await this.generate(options);
    const words = full.split(' ');
    for (const word of words) {
      yield word + ' ';
    }
  }

  private mockExtraction(userContent: string): MemoryCandidate[] {
    const lower = userContent.toLowerCase();
    const memories: MemoryCandidate[] = [];

    if (lower.includes('bangalore')) {
      memories.push({
        type: 'location',
        memory_class: 'SEMANTIC',
        subject: 'user',
        key: 'city',
        value: 'Bangalore',
        confidence: 0.95,
        importance: 0.8
      });
    }

    if (lower.includes('google')) {
      memories.push({
        type: 'occupation',
        memory_class: 'SEMANTIC',
        subject: 'user',
        key: 'employer',
        value: 'Google',
        confidence: 0.98,
        importance: 0.9
      });
    } else if (lower.includes('microsoft')) {
      memories.push({
        type: 'occupation',
        memory_class: 'SEMANTIC',
        subject: 'user',
        key: 'employer',
        value: 'Microsoft',
        confidence: 0.95,
        importance: 0.9
      });
    }

    if (lower.includes('cat') || lower.includes('oliver')) {
      memories.push({
        type: 'preference',
        memory_class: 'SEMANTIC',
        subject: 'user',
        key: 'pet',
        value: 'cat',
        confidence: 0.9,
        importance: 0.7
      });
    }

    if (lower.includes('dog') || lower.includes('max')) {
      memories.push({
        type: 'preference',
        memory_class: 'SEMANTIC',
        subject: 'user',
        key: 'dog_name',
        value: 'Max',
        confidence: 0.95,
        importance: 0.7
      });
    }

    if (lower.includes('tea') && (lower.includes('favorite') || lower.includes('drink') || lower.includes('love'))) {
      memories.push({
        type: 'preference',
        memory_class: 'SEMANTIC',
        subject: 'user',
        key: 'favorite_drink',
        value: 'tea',
        confidence: 0.9,
        importance: 0.7
      });
    }

    if (lower.includes('back pain')) {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      memories.push({
        type: 'health',
        memory_class: 'WORKING',
        subject: 'user',
        key: 'current_health_issue',
        value: 'back pain since this morning',
        confidence: 0.95,
        importance: 0.85,
        expires_at: tomorrow
      });
    }

    if (lower.includes('meeting')) {
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      memories.push({
        type: 'plan',
        memory_class: 'EPISODIC',
        subject: 'user',
        key: 'upcoming_meeting',
        value: 'meeting with team on project sync',
        confidence: 0.9,
        importance: 0.6,
        expires_at: nextWeek
      });
    }

    return memories;
  }

  private mockChatReply(messages: LLMMessage[]): string {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content.toLowerCase() || '';
    const systemPrompt = messages.find(m => m.role === 'system')?.content || '';

    // If answering about location
    if (lastUser.includes('where do i live') || lastUser.includes('where i live')) {
      if (systemPrompt.includes('Bangalore')) {
        return 'You mentioned you live in Bangalore!';
      }
      return 'I do not have a record of where you currently live.';
    }

    // If answering about job
    if (lastUser.includes('where do i work') || lastUser.includes('where i work')) {
      if (systemPrompt.includes('Google') || systemPrompt.includes('"Google"')) {
        return 'You work at Google as an engineer now!';
      }
      if (systemPrompt.includes('Microsoft') || systemPrompt.includes('"Microsoft"')) {
        return 'You work at Microsoft.';
      }
      return 'I am not sure where you currently work.';
    }

    // If answering about dog
    if (lastUser.includes('dog name') || lastUser.includes('what is my dog') || lastUser.includes('tell me about my dog')) {
      if (systemPrompt.includes('Max') || systemPrompt.includes('"Max"')) {
        return 'Your dog is named Max!';
      }
      return "I don't recall you mentioning your dog's name yet.";
    }

    // If answering about feeling / health
    if (lastUser.includes('why am i not feeling') || lastUser.includes('not great') || lastUser.includes('why do i feel')) {
      if (systemPrompt.includes('back pain')) {
        return "You mentioned you've been having back pain since this morning. Please make sure to rest!";
      }
      return "I'm not sure why you are feeling unwell right now.";
    }

    // If answering about hobbies / self
    if (lastUser.includes('tell me about yourself') || lastUser.includes('who are you') || lastUser.includes('hobbies')) {
      return "I'm Maya! I love film photography, brewing jasmine tea, going for quiet walks, and reading books by the window.";
    }

    // Default friendly companion response
    return "That's wonderful to hear. I'm right here with you!";
  }
}

export class MockEmbeddingService {
  public async getEmbedding(text: string): Promise<number[]> {
    return this.hashTextToVector(text);
  }

  public async getEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(t => this.hashTextToVector(t));
  }

  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private hashTextToVector(text: string, dimensions = 1024): number[] {
    const vec = new Array(dimensions).fill(0);
    const clean = text.toLowerCase().trim();
    const tokens = clean.split(/[^\w]+/).filter(t => t.length > 1);

    // Concept tags to simulate semantic embeddings in test mocks
    const expanded = new Set(tokens);
    for (const t of tokens) {
      if (['work', 'job', 'employer', 'company', 'career', 'office', 'profession', 'engineer'].includes(t)) {
        expanded.add('__concept_occupation__');
      } else if (['live', 'living', 'city', 'location', 'residence', 'reside', 'hometown'].includes(t)) {
        expanded.add('__concept_location__');
      } else if (['drink', 'beverage', 'tea', 'coffee'].includes(t)) {
        expanded.add('__concept_drink__');
      } else if (['dog', 'cat', 'pet', 'animal'].includes(t)) {
        expanded.add('__concept_pet__');
      } else if (['pain', 'sick', 'health', 'hurt', 'ill'].includes(t)) {
        expanded.add('__concept_health__');
      }
    }

    // Hash whole tokens
    for (const token of expanded) {
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash * 37 + token.charCodeAt(i)) & 0x7fffffff;
      }
      const idx = Math.abs(hash) % dimensions;
      vec[idx] += 1.0;
    }

    // Normalize vector
    let norm = 0;
    for (let i = 0; i < dimensions; i++) norm += vec[i] * vec[i];
    if (norm > 0) {
      const sqrtNorm = Math.sqrt(norm);
      for (let i = 0; i < dimensions; i++) vec[i] /= sqrtNorm;
    }
    return vec;
  }
}
