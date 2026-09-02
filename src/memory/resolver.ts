import { MemoryRepository } from '../storage/memories.js';
import { LLMClient } from '../llm/client.js';
import { MemoryCandidate, MemoryCandidateInput, MemoryCandidateSchema, MemoryRecord, MemoryStatus } from './types.js';

export type ResolutionAction = 'ADD' | 'REINFORCE' | 'SUPERSEDE' | 'EXPIRE' | 'DISCARD';

export interface ResolutionResult {
  action: ResolutionAction;
  memory: MemoryRecord;
  superseded?: MemoryRecord;
  reason: string;
}

export class MemoryResolver {
  private memoryRepo: MemoryRepository;
  private llmClient: LLMClient;

  constructor(memoryRepo: MemoryRepository, llmClient: LLMClient) {
    this.memoryRepo = memoryRepo;
    this.llmClient = llmClient;
  }

  public async resolveCandidate(
    candidate: MemoryCandidateInput,
    userMessage?: string,
    sourceMessageId?: string | null,
    embedding?: number[] | null
  ): Promise<ResolutionResult> {
    const parsedCandidate = MemoryCandidateSchema.parse(candidate);

    const existingActive = this.memoryRepo.getActiveMemoryByKey(
      parsedCandidate.key,
      parsedCandidate.subject || 'user'
    );

    // 1. If no active memory exists for this key, simply create a new active record
    if (!existingActive) {
      const created = this.memoryRepo.createMemory(parsedCandidate, 'ACTIVE', sourceMessageId, embedding);
      return {
        action: 'ADD',
        memory: created,
        reason: `New fact recorded for key '${parsedCandidate.key}'.`
      };
    }

    // 2. If existing memory has identical / closely normalized value -> Reinforce
    if (this.isEquivalentValue(existingActive.value, parsedCandidate.value)) {
      const reinforcedConfidence = Math.min(1.0, Math.max(existingActive.confidence, parsedCandidate.confidence) + 0.05);
      const updated = this.memoryRepo.reinforceMemory(existingActive.id, reinforcedConfidence);

      return {
        action: 'REINFORCE',
        memory: updated || existingActive,
        reason: `Reinforced existing fact '${parsedCandidate.key}' with confirming statement.`
      };
    }

    // 3. Stateful attributes that naturally replace previous values
    // (e.g. employer, city, location, partner, relationship_status, favorite_drink)
    const isNaturallyExclusive = this.isExclusiveKey(parsedCandidate.key, parsedCandidate.type);

    if (isNaturallyExclusive) {
      // Atomic transactional supersession
      const { newMemory, supersededMemory } = this.memoryRepo.supersedeMemory(
        existingActive.id,
        parsedCandidate,
        sourceMessageId,
        embedding
      );

      return {
        action: 'SUPERSEDE',
        memory: newMemory,
        superseded: supersededMemory,
        reason: `Stateful update: '${parsedCandidate.key}' transitioned from '${existingActive.value}' to '${parsedCandidate.value}'.`
      };
    }

    // 4. For ambiguous non-exclusive categories (e.g. general 'fact' or 'hobby'), ask LLM classifier
    const classification = await this.classifyConflict({
      existing: existingActive,
      candidate: parsedCandidate,
      userMessage: userMessage || parsedCandidate.value
    });

    if (classification.relationship === 'SUPERSEDES') {
      const { newMemory, supersededMemory } = this.memoryRepo.supersedeMemory(
        existingActive.id,
        parsedCandidate,
        sourceMessageId,
        embedding
      );

      return {
        action: 'SUPERSEDE',
        memory: newMemory,
        superseded: supersededMemory,
        reason: classification.reason || `LLM determined new value supersedes prior value for '${parsedCandidate.key}'.`
      };
    } else if (classification.relationship === 'IGNORE') {
      // Classifier explicitly determined the candidate should be ignored/discarded
      return {
        action: 'DISCARD',
        memory: existingActive,
        reason: classification.reason || `Candidate memory for key '${parsedCandidate.key}' was discarded as redundant/irrelevant.`
      };
    } else {
      // Add alongside as another active entry (e.g. multiple hobbies or goals)
      const newMemory = this.memoryRepo.createMemory(parsedCandidate, 'ACTIVE', sourceMessageId, embedding);
      return {
        action: 'ADD',
        memory: newMemory,
        reason: classification.reason || `Added additional value for key '${parsedCandidate.key}'.`
      };
    }
  }

  public async resolveCandidates(
    candidates: MemoryCandidateInput[],
    userMessage?: string,
    sourceMessageId?: string | null,
    embeddings?: Map<string, number[]>
  ): Promise<ResolutionResult[]> {
    const results: ResolutionResult[] = [];
    for (const candidate of candidates) {
      const candidateKey = `${candidate.key}:${candidate.value}`;
      const embedding = embeddings?.get(candidateKey) || null;
      const result = await this.resolveCandidate(candidate, userMessage, sourceMessageId, embedding);
      results.push(result);
    }
    return results;
  }

  private isEquivalentValue(val1: string, val2: string): boolean {
    const normalize = (s: string) => s.toLowerCase().trim().replace(/[^\w\s]/g, '');
    return normalize(val1) === normalize(val2);
  }

  private isExclusiveKey(key: string, type: string): boolean {
    const k = key.toLowerCase().trim();

    // 1. Types that are structurally single-valued / stateful
    const statefulTypes = ['occupation', 'location', 'relationship', 'health', 'state'];
    if (statefulTypes.includes(type.toLowerCase().trim())) {
      return true;
    }

    // 2. Structural key prefixes that inherently designate singular attributes
    if (k.startsWith('favorite_') || k.startsWith('current_') || k.startsWith('primary_')) {
      return true;
    }

    return false;
  }

  private async classifyConflict(params: {
    existing: MemoryRecord;
    candidate: MemoryCandidate;
    userMessage: string;
  }): Promise<{ relationship: 'SUPERSEDES' | 'ADDITIONAL' | 'IGNORE'; reason?: string }> {
    const systemPrompt = `You are a strict Memory Contradiction Resolver for an AI companion.
Determine whether a new user statement supersedes/replaces an existing memory, or is simply an additional distinct fact.

Output strictly a JSON object:
{
  "relationship": "SUPERSEDES" | "ADDITIONAL" | "IGNORE",
  "reason": "short explanation"
}`;

    const prompt = `Existing memory:
Key: "${params.existing.key}"
Value: "${params.existing.value}" (Status: ACTIVE)

New statement / candidate:
Key: "${params.candidate.key}"
Value: "${params.candidate.value}"
User Message Context: "${params.userMessage}"

Does the new candidate supersede the old memory or coexist alongside it?`;

    try {
      const res = await this.llmClient.generate({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        responseFormat: { type: 'json_object' }
      });

      let jsonStr = res.trim();
      const codeMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/i);
      if (codeMatch && codeMatch[1]) {
        jsonStr = codeMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      if (parsed.relationship === 'SUPERSEDES' || parsed.relationship === 'ADDITIONAL' || parsed.relationship === 'IGNORE') {
        return parsed;
      }
      return { relationship: 'ADDITIONAL', reason: 'Default fallback — conservatively coexist to avoid data loss' };
    } catch (err: any) {
      console.debug('[MemoryResolver] Conflict classification failed, defaulting to ADDITIONAL:', err.message);
      return { relationship: 'ADDITIONAL', reason: 'Conservative fallback on classification error' };
    }
  }
}
