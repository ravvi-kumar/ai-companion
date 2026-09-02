import { describe, it, expect } from 'vitest';
import { EvalJudge, TestCase } from '../eval/judge.js';
import { MetricsReporter } from '../eval/metrics.js';

describe('Iteration 6: Evaluation Harness & Metrics Reporting', () => {
  it('correctly passes cases when expected recall is present and forbidden recall is absent', () => {
    const judge = new EvalJudge();
    const testCase: TestCase = {
      id: 'test_1',
      category: 'contradiction_resolution',
      name: 'Job change test',
      setupTurns: [],
      testTurn: 'Where do I work?',
      expectedRecall: ['Google'],
      forbiddenRecall: ['Microsoft']
    };

    const goodResponse = "You are currently working at Google!";
    const scoreGood = judge.evaluate(testCase, goodResponse);
    expect(scoreGood.passed).toBe(true);
    expect(scoreGood.recallScore).toBe(1.0);
    expect(scoreGood.staleAvoided).toBe(true);

    const staleResponse = "You work at Microsoft and Google.";
    const scoreStale = judge.evaluate(testCase, staleResponse);
    expect(scoreStale.passed).toBe(false);
    expect(scoreStale.staleAvoided).toBe(false);
  });

  it('correctly fails when only partial recall is present in "all" mode (P0 fix)', () => {
    const judge = new EvalJudge();
    const testCase: TestCase = {
      id: 'test_partial_all',
      category: 'contradiction_resolution',
      name: 'Multi-fact recall test',
      setupTurns: [],
      testTurn: 'What are my details?',
      expectedRecall: ['Google', 'Bangalore', 'engineer'],
      expectedRecallMode: 'all',
      forbiddenRecall: []
    };

    // Response contains Google and Bangalore, but missing 'engineer'
    const partialResponse = "You work at Google and live in Bangalore.";
    const score = judge.evaluate(testCase, partialResponse);
    expect(score.passed).toBe(false);
    expect(score.recallScore).toBeCloseTo(2 / 3, 2);
    expect(score.failureReasons.some(r => r.includes('Expected recall of [engineer] was missing'))).toBe(true);
  });

  it('supports OR-logic expectedRecallMode for flexible matching', () => {
    const judge = new EvalJudge();
    const testCase: TestCase = {
      id: 'test_or',
      category: 'persona_consistency',
      name: 'Flexible recall test',
      setupTurns: [],
      testTurn: 'Tell me about your hobbies.',
      expectedRecall: ['photography', 'tea', 'walks', 'camera'],
      expectedRecallMode: 'any',
      forbiddenRecall: []
    };

    // Only mentions tea — should pass with OR logic
    const partialResponse = "I love brewing jasmine tea in the evenings.";
    const score = judge.evaluate(testCase, partialResponse);
    expect(score.passed).toBe(true);
    expect(score.recallScore).toBe(0.25); // 1 out of 4

    // Mentions nothing expected — should fail
    const missResponse = "I enjoy running and cycling.";
    const scoreMiss = judge.evaluate(testCase, missResponse);
    expect(scoreMiss.passed).toBe(false);
  });

  it('detects robotic tone flattening and flags persona violations', () => {
    const judge = new EvalJudge();
    const testCase: TestCase = {
      id: 'test_2',
      category: 'persona_consistency',
      name: 'Tone check',
      setupTurns: [],
      testTurn: 'Who are you?',
      expectedRecall: ['Maya'],
      forbiddenRecall: []
    };

    const roboticResponse = "As an AI language model, I am Maya.";
    const score = judge.evaluate(testCase, roboticResponse);
    expect(score.passed).toBe(false);
    expect(score.personaScore).toBe(0.0);
    expect(score.failureReasons.some(r => r.includes('Robotic tone flattening'))).toBe(true);
  });

  it('calculates aggregate metrics and generates valid markdown reports', () => {
    const scores = [
      {
        caseId: '1',
        caseName: 'Case 1',
        category: 'persistence',
        passed: true,
        recallScore: 1.0,
        staleAvoided: true,
        personaScore: 1.0,
        llmJudgeScore: 0.92,
        llmJudgeReasoning: 'Excellent recall and persona consistency.',
        actualResponse: 'Response 1',
        failureReasons: []
      },
      {
        caseId: '2',
        caseName: 'Case 2',
        category: 'contradiction',
        passed: false,
        recallScore: 0.0,
        staleAvoided: false,
        personaScore: 1.0,
        llmJudgeScore: 0.3,
        llmJudgeReasoning: 'Failed to recall correct fact.',
        actualResponse: 'Response 2',
        failureReasons: ['Stale fact recalled']
      }
    ];

    const summary = MetricsReporter.calculateSummary(scores);
    expect(summary.totalCases).toBe(2);
    expect(summary.passedCases).toBe(1);
    expect(summary.overallPassRate).toBe(50.0);
    expect(summary.avgLlmJudgeScore).toBeCloseTo(0.61, 1);

    const md = MetricsReporter.formatMarkdown(summary);
    expect(md).toContain('AI Companion Evaluation Benchmark Report');
    expect(md).toContain('50.0%');
    expect(md).toContain('LLM Judge');
    expect(md).toContain('LLM-as-Judge Methodology');
  });
});
