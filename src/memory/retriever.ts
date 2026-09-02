import { MemoryRepository } from '../storage/memories.js';
import { EmbeddingService } from '../llm/embeddings.js';
import { MemoryRecord } from './types.js';

export interface RankedMemory {
  memory: MemoryRecord;
  score: number;
  semanticSimilarity: number;
  recencyScore: number;
}

export interface RetrievalOptions {
  query: string;
  subject?: string;
  limit?: number;
  minScoreThreshold?: number;
}

export class MemoryRetriever {
  private memoryRepo: MemoryRepository;
  private embeddingService: EmbeddingService;

  constructor(memoryRepo: MemoryRepository, embeddingService: EmbeddingService) {
    this.memoryRepo = memoryRepo;
    this.embeddingService = embeddingService;
  }

  public async retrieve(options: RetrievalOptions): Promise<RankedMemory[]> {
    const {
      query,
      subject = 'user',
      limit = 5,
      minScoreThreshold = 0.25
    } = options;

    // 1. Structured candidate filtering: Fetch only ACTIVE memories (automatically applies decay & temporal validity)
    const activeMemories = this.memoryRepo.getActiveMemories(subject);
    if (activeMemories.length === 0) {
      return [];
    }

    // 2. Generate embedding for current query with graceful fallback on outage
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await this.embeddingService.getEmbedding(query);
    } catch (err: any) {
      console.debug('[MemoryRetriever] Query embedding failed (using keyword/structured fallback):', err.message);
      queryEmbedding = null;
    }

    // 3. Use stored embeddings where available; compute on-the-fly only for memories missing them
    const memoryEmbeddings: (number[] | null)[] = new Array(activeMemories.length).fill(null);

    if (queryEmbedding) {
      const memoriesNeedingEmbeddings: { index: number; text: string }[] = [];

      for (let i = 0; i < activeMemories.length; i++) {
        const memory = activeMemories[i];
        if (memory.embedding && memory.embedding.length > 0) {
          memoryEmbeddings[i] = memory.embedding;
        } else {
          memoriesNeedingEmbeddings.push({
            index: i,
            text: `[${memory.memory_class}] [${memory.type}] ${memory.key}: ${memory.value}`
          });
        }
      }

      if (memoriesNeedingEmbeddings.length > 0) {
        try {
          const texts = memoriesNeedingEmbeddings.map(m => m.text);
          const computed = await this.embeddingService.getEmbeddings(texts);
          for (let j = 0; j < memoriesNeedingEmbeddings.length; j++) {
            memoryEmbeddings[memoriesNeedingEmbeddings[j].index] = computed[j] || [];
          }
        } catch (err: any) {
          console.debug('[MemoryRetriever] Batch memory embedding computation failed:', err.message);
        }
      }
    }

    // 4. Compute composite rankings with distractor gating
    const now = Date.now();
    const ranked: RankedMemory[] = [];

    for (let i = 0; i < activeMemories.length; i++) {
      const memory = activeMemories[i];
      const memEmbedding = memoryEmbeddings[i] || [];

      const semanticSimilarity = (queryEmbedding && memEmbedding.length > 0)
        ? Math.max(0, this.embeddingService.cosineSimilarity(queryEmbedding, memEmbedding))
        : 0;

      const lexicalSimilarity = this.computeLexicalSimilarity(query, memory);

      // Base relevance is maximum of vector semantic similarity and lexical keyword similarity
      const baseRelevance = queryEmbedding
        ? Math.max(semanticSimilarity, lexicalSimilarity * 0.85)
        : lexicalSimilarity;

      // Distractor Gate: Require baseline semantic or lexical relevance before applying boosts.
      // Irrelevant memories with 0 base relevance must not be recalled simply due to recency/importance.
      const isWorkingMemoryRecent = memory.memory_class === 'WORKING' && (now - new Date(memory.updated_at).getTime() < 3600000);
      if (baseRelevance < 0.15 && !isWorkingMemoryRecent) {
        continue;
      }

      // Recency score: exponential decay over 30 days
      const memoryAgeMs = now - new Date(memory.updated_at).getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const recencyScore = Math.max(0, 1 - memoryAgeMs / thirtyDaysMs);

      // Working memory recency boost for active immediate context
      const tierBoost = memory.memory_class === 'WORKING' ? 0.15 : memory.memory_class === 'EPISODIC' ? 0.08 : 0.0;

      // Composite scoring formula
      const score =
        baseRelevance * 0.50 +
        (memory.importance ?? 0.5) * 0.20 +
        (memory.confidence ?? 0.9) * 0.15 +
        recencyScore * 0.10 +
        tierBoost;

      if (score >= minScoreThreshold) {
        ranked.push({
          memory,
          score,
          semanticSimilarity: baseRelevance,
          recencyScore
        });
      }
    }

    // 5. Sort by composite score descending and apply context budget limit
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }

  /**
   * Computes domain-agnostic lexical & keyword overlap between the user query
   * and structured memory fields (key, value, type).
   *
   * Used in hybrid retrieval alongside vector semantic similarity to prioritize
   * exact keyword, proper noun, and identifier matches, as well as serving as
   * the primary ranking mechanism during embedding outages.
   */
  private computeLexicalSimilarity(query: string, memory: MemoryRecord): number {
    const queryTokens = query.toLowerCase().split(/[^\w]+/).filter(t => t.length >= 2);
    if (queryTokens.length === 0) return 0;

    const memoryKeyTokens = memory.key.toLowerCase().split(/[^\w]+/);
    const memoryValueTokens = memory.value.toLowerCase().split(/[^\w]+/);
    const memoryTypeTokens = memory.type.toLowerCase().split(/[^\w]+/);
    const allMemoryTokens = new Set([...memoryKeyTokens, ...memoryValueTokens, ...memoryTypeTokens]);
    const memoryFullText = `${memory.key.replace(/_/g, ' ')} ${memory.value} ${memory.type}`.toLowerCase();

    let matchScore = 0;
    for (const qToken of queryTokens) {
      if (allMemoryTokens.has(qToken)) {
        matchScore += 1.0;
      } else if (qToken.length >= 4 && memoryFullText.includes(qToken)) {
        matchScore += 0.75;
      }
    }

    const divisor = Math.max(1, Math.min(queryTokens.length, 3));
    return Math.min(1.0, matchScore / divisor);
  }
}
