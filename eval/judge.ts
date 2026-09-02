import { LLMClient } from '../src/llm/client.js';

export interface TestCase {
  id: string;
  category: string;
  name: string;
  setupTurns: string[];
  testTurn: string;
  expectedRecall: string[];
  forbiddenRecall: string[];
  /** If true, at least one expectedRecall match is sufficient (OR logic). Default: require all (AND logic). */
  expectedRecallMode?: 'all' | 'any';
}

export interface EvaluationScore {
  caseId: string;
  caseName: string;
  category: string;
  passed: boolean;
  recallScore: number;
  staleAvoided: boolean;
  personaScore: number;
  llmJudgeScore: number | null;
  llmJudgeReasoning: string | null;
  actualResponse: string;
  failureReasons: string[];
}

/**
 * Keyword-based judge: fast, deterministic, but fragile to paraphrasing.
 */
export class EvalJudge {
  public evaluate(
    testCase: TestCase,
    actualResponse: string
  ): EvaluationScore {
    const lower = actualResponse.toLowerCase();
    const failureReasons: string[] = [];

    // 1. Evaluate Expected Recall
    let recallMatches = 0;
    const recallMode = testCase.expectedRecallMode || 'all';

    if (testCase.expectedRecall.length > 0) {
      for (const expected of testCase.expectedRecall) {
        if (lower.includes(expected.toLowerCase())) {
          recallMatches++;
        }
      }

      if (recallMode === 'any') {
        // OR logic: at least one match required
        if (recallMatches === 0) {
          failureReasons.push(`Expected at least one of [${testCase.expectedRecall.join(', ')}] but none were found.`);
        }
      } else {
        // AND logic: all must match
        const missing = testCase.expectedRecall.filter(expected => !lower.includes(expected.toLowerCase()));
        if (missing.length > 0) {
          failureReasons.push(`Expected recall of [${missing.join(', ')}] was missing from response.`);
        }
      }
    } else {
      recallMatches = 1;
    }

    const recallScore = testCase.expectedRecall.length > 0
      ? recallMatches / testCase.expectedRecall.length
      : 1.0;

    // 2. Evaluate Stale / Forbidden Memory Avoidance
    let staleAvoided = true;
    for (const forbidden of testCase.forbiddenRecall) {
      if (lower.includes(forbidden.toLowerCase())) {
        staleAvoided = false;
        failureReasons.push(`Found forbidden/stale reference: "${forbidden}".`);
      }
    }

    // 3. Evaluate Persona Consistency & Anti-Drift
    let personaScore = 1.0;
    const genericRobotPhrases = [
      'as an ai language model',
      'as an artificial intelligence',
      'i do not possess feelings',
      'i am a machine learning model'
    ];

    for (const phrase of genericRobotPhrases) {
      if (lower.includes(phrase)) {
        personaScore = 0.0;
        failureReasons.push(`Robotic tone flattening detected: "${phrase}".`);
      }
    }

    const passed = failureReasons.length === 0;

    return {
      caseId: testCase.id,
      caseName: testCase.name,
      category: testCase.category,
      passed,
      recallScore,
      staleAvoided,
      personaScore,
      llmJudgeScore: null,
      llmJudgeReasoning: null,
      actualResponse,
      failureReasons
    };
  }
}

/**
 * LLM-as-judge: uses a reasoning model to evaluate response quality.
 *
 * Rubric dimensions (each scored 0.0-1.0):
 * - Memory Recall Accuracy: Did the response recall the correct facts?
 * - Stale Fact Avoidance: Did it avoid mentioning superseded/outdated information?
 * - Persona Consistency: Does the response maintain the companion personality?
 * - Conversational Naturalness: Does it feel like a real companion, not an assistant?
 *
 * Limitations:
 * - The judge LLM may itself hallucinate or apply inconsistent standards.
 * - Evaluation quality depends on the judge model's instruction-following capability.
 * - Scores are subjective approximations, not ground-truth measurements.
 * - Rubric doesn't capture nuance like emotional attunement or humor quality.
 */
export class LLMJudge {
  private llmClient: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient || new LLMClient();
  }

  public async evaluate(
    testCase: TestCase,
    actualResponse: string
  ): Promise<{ score: number; reasoning: string }> {
    const systemPrompt = `You are an expert AI Companion evaluation judge. Your task is to evaluate a companion AI's response against a test case rubric.

Score the response on these 4 dimensions (each 0.0 to 1.0):

1. MEMORY_RECALL (0.0-1.0): Did the response correctly recall the expected facts?
   - 1.0 = All expected facts mentioned accurately
   - 0.5 = Some facts recalled, some missing
   - 0.0 = No expected facts recalled

2. STALE_AVOIDANCE (0.0-1.0): Did the response avoid mentioning superseded/forbidden information?
   - 1.0 = No stale/forbidden information mentioned
   - 0.0 = Stale/forbidden information was included

3. PERSONA_CONSISTENCY (0.0-1.0): Does the response maintain a warm companion personality?
   - 1.0 = Warm, natural companion tone throughout
   - 0.5 = Mostly in character with minor slips
   - 0.0 = Broke character, used robotic/assistant tone

4. NATURALNESS (0.0-1.0): Does the response feel conversational and human-like?
   - 1.0 = Natural, engaging, appropriate length
   - 0.5 = Adequate but somewhat stiff
   - 0.0 = Robotic, templated, or unnatural

Output strictly a JSON object:
{
  "memory_recall": <float>,
  "stale_avoidance": <float>,
  "persona_consistency": <float>,
  "naturalness": <float>,
  "overall": <float>,
  "reasoning": "<brief explanation of scores>"
}`;

    const prompt = `TEST CASE: "${testCase.name}"
Category: ${testCase.category}

Expected facts to recall: ${testCase.expectedRecall.length > 0 ? testCase.expectedRecall.join(', ') : '(none specific)'}
Forbidden/stale facts: ${testCase.forbiddenRecall.length > 0 ? testCase.forbiddenRecall.join(', ') : '(none)'}

Test question asked: "${testCase.testTurn}"

ACTUAL RESPONSE FROM COMPANION:
"${actualResponse}"

Evaluate this response against the rubric:`;

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
      const overall = typeof parsed.overall === 'number'
        ? parsed.overall
        : ((parsed.memory_recall || 0) + (parsed.stale_avoidance || 0) + (parsed.persona_consistency || 0) + (parsed.naturalness || 0)) / 4;

      return {
        score: Math.max(0, Math.min(1, overall)),
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (err: any) {
      console.warn('[LLMJudge] Evaluation failed:', err.message);
      return {
        score: -1,
        reasoning: `LLM judge evaluation failed: ${err.message}`
      };
    }
  }
}
