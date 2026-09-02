import { LLMClient } from '../llm/client.js';
import {
  ExtractedMemoriesResponseSchema,
  MemoryCandidate
} from './types.js';

export type ExtractionContextRole = 'user' | 'assistant' | 'system';

export interface MemoryExtractorOptions {
  userMessage: string;
  recentMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  /** Which message roles to include in extraction context. Defaults to ['user'] to prevent hallucination feedback loops. */
  extractionContextRoles?: ExtractionContextRole[];
}

export class MemoryExtractor {
  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  public async extract(options: MemoryExtractorOptions): Promise<MemoryCandidate[]> {
    const { userMessage, recentMessages = [], extractionContextRoles = ['user'] } = options;

    // Quick heuristic filter: don't extract from short trivial greetings
    const trimmed = userMessage.trim().toLowerCase();
    const trivialGreetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'bye', 'ok', 'okay', 'yes', 'no'];
    if (trivialGreetings.includes(trimmed)) {
      return [];
    }

    const systemPrompt = `You are an expert AI Memory Extraction engine for an AI Companion system (Maya).
Your task is to analyze the USER's statements and extract structured memories across 3 distinct memory tiers:

1. WORKING MEMORY (memory_class: "WORKING")
   - Current physical feelings, acute health symptoms, or momentary emotional states (e.g., "back pain since this morning", "feeling exhausted today", "headache").
   - Immediate ongoing activities or short-term situation.
   - Default expires_at: 24 hours from now.

2. EPISODIC MEMORY (memory_class: "EPISODIC")
   - Specific dated events, temporary plans, meetings, or recent experiences (e.g., "meeting tomorrow at 10 AM", "went for a run this morning", "flight on Friday").
   - Default expires_at: 2 to 7 days from now (or right after the scheduled event).

3. SEMANTIC MEMORY (memory_class: "SEMANTIC")
   - Durable long-term facts, preferences, background, pets, family members, occupations, skills, locations, habits (e.g., "employer: Google", "dog: Max", "favorite_drink: matcha", "city: Bangalore").
   - Long-lived / permanent (expires_at: null).

RULES:
1. ONLY extract information originating from the USER. Never extract assistant suggestions as user facts.
2. Formulate canonical snake_case 'key' identifiers (e.g. 'employer', 'city', 'current_health_issue', 'dog_name', 'upcoming_meeting').
3. For 'subject', use 'user' unless referring to a named family member/friend (e.g., 'user_mom').
4. Valid types are: 'fact', 'preference', 'relationship', 'goal', 'plan', 'occupation', 'location', 'habit', 'life_event', 'health', 'state', 'activity'.
5. Valid memory_class values are: 'WORKING', 'EPISODIC', 'SEMANTIC'.
6. Rate 'confidence' (0.0 to 1.0) and 'importance' (0.0 to 1.0).
7. If the user message contains no personal state, disclosure, or facts (e.g., generic questions, meta-questions), return an empty array.
8. Output strictly a JSON object conforming to:
{
  "memories": [
    {
      "type": "health",
      "memory_class": "WORKING",
      "subject": "user",
      "key": "current_health_issue",
      "value": "back pain since this morning",
      "confidence": 0.95,
      "importance": 0.8
    }
  ]
}`;

    // Filter context messages to only allowed roles (configurable to prevent hallucination feedback loops)
    const allowedRoles = new Set(extractionContextRoles);
    const filteredMessages = recentMessages.filter(m => allowedRoles.has(m.role));
    const conversationContext = filteredMessages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');

    const prompt = `Recent context:
${conversationContext || '(None)'}

Latest User Message:
"${userMessage}"

Extract user memories as JSON:`;

    try {
      const rawResponse = await this.llmClient.generate({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        responseFormat: { type: 'json_object' }
      });

      // Extract JSON substring if LLM wraps in markdown
      let jsonStr = rawResponse.trim();
      const codeBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/i) || jsonStr.match(/```\s*([\s\S]*?)\s*```/i);
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonStr = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      const validated = ExtractedMemoriesResponseSchema.safeParse(parsed);

      if (validated.success) {
        const now = Date.now();
        return validated.data.memories.map(m => {
          // Normalize default expirations if not explicitly populated by LLM
          let expiresAt = m.expires_at;
          if (!expiresAt) {
            if (m.memory_class === 'WORKING') {
              expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
            } else if (m.memory_class === 'EPISODIC') {
              expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
            }
          }
          return {
            ...m,
            expires_at: expiresAt || null
          };
        });
      } else {
        console.warn('[MemoryExtractor] Schema validation failed:', validated.error.format());
        return [];
      }
    } catch (err: any) {
      console.warn('[MemoryExtractor] Extraction error:', err.message);
      return [];
    }
  }
}

