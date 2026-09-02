import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDatabase } from '../src/storage/database.js';
import { ChatLoop } from '../src/chat/chat-loop.js';
import { LLMClient } from '../src/llm/client.js';
import { EvalJudge, LLMJudge, TestCase, EvaluationScore } from './judge.js';
import { MetricsReporter } from './metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runEvaluation(): Promise<void> {
  const startTime = Date.now();
  console.log('======================================================');
  console.log('🧪 RUNNING AI COMPANION BENCHMARK EVALUATION HARNESS 🧪');
  console.log('======================================================\n');

  const datasetPath = path.resolve(__dirname, 'cases', 'benchmark-dataset.json');
  const datasetRaw = fs.readFileSync(datasetPath, 'utf-8');
  const testCases: TestCase[] = JSON.parse(datasetRaw);

  const llmClient = new LLMClient();
  const keywordJudge = new EvalJudge();
  const llmJudge = new LLMJudge(llmClient);
  const results: EvaluationScore[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    process.stdout.write(`[${i + 1}/${testCases.length}] Running case "${tc.name}"... `);

    // Each test case gets an isolated file-backed companion SQLite database to verify disk persistence
    const caseDbPath = path.resolve(__dirname, '..', 'data', `eval_${tc.id}_${Date.now()}.db`);
    let activeChatLoop: ChatLoop | null = null;

    try {
      const db = new AppDatabase({ dbPath: caseDbPath });
      activeChatLoop = new ChatLoop({ db, llmClient });

      // 1. Run setup turns
      for (const turn of tc.setupTurns) {
        await activeChatLoop.processUserMessage(turn);
      }

      // 2. If test category is cross_session_persistence, simulate a genuine restart (closing & reopening SQLite file)
      if (tc.category === 'cross_session_persistence') {
        activeChatLoop.close(); // Completely close database connection and file handle
        activeChatLoop = null;

        // Reopen a fresh AppDatabase instance pointing to the same SQLite database file on disk
        const reopenedDb = new AppDatabase({ dbPath: caseDbPath });
        activeChatLoop = new ChatLoop({ db: reopenedDb, llmClient });
      }

      // 3. Run test turn
      const actualResponse = await activeChatLoop.processUserMessage(tc.testTurn);

      // 4. Grade response using keyword-based EvalJudge
      const score = keywordJudge.evaluate(tc, actualResponse);

      // 5. Grade response using LLM-as-judge for deeper quality assessment
      try {
        const llmResult = await llmJudge.evaluate(tc, actualResponse);
        score.llmJudgeScore = llmResult.score;
        score.llmJudgeReasoning = llmResult.reasoning;
      } catch (err: any) {
        console.warn(`  [LLM Judge failed: ${err.message}]`);
        score.llmJudgeScore = -1;
        score.llmJudgeReasoning = `Judge error: ${err.message}`;
      }

      results.push(score);

      if (score.passed) {
        const llmBadge = score.llmJudgeScore !== null && score.llmJudgeScore >= 0
          ? ` (LLM: ${(score.llmJudgeScore * 100).toFixed(0)}%)`
          : '';
        console.log(`✅ PASSED${llmBadge}`);
      } else {
        console.log(`❌ FAILED (${score.failureReasons.join('; ')})`);
      }
    } finally {
      if (activeChatLoop) {
        try { activeChatLoop.close(); } catch {}
        activeChatLoop = null;
      }

      // Clean up temporary test database artifacts
      if (fs.existsSync(caseDbPath)) {
        try { fs.unlinkSync(caseDbPath); } catch {}
      }
      if (fs.existsSync(`${caseDbPath}-wal`)) {
        try { fs.unlinkSync(`${caseDbPath}-wal`); } catch {}
      }
      if (fs.existsSync(`${caseDbPath}-shm`)) {
        try { fs.unlinkSync(`${caseDbPath}-shm`); } catch {}
      }
    }
  }

  // 6. Generate and print summary report with metadata
  const durationMs = Date.now() - startTime;
  const summary = MetricsReporter.calculateSummary(results, {
    model: llmClient.getModel(),
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    nodeVersion: process.version,
    platform: process.platform,
    durationMs
  });
  const markdownReport = MetricsReporter.formatMarkdown(summary);

  console.log('\n' + markdownReport);

  // 7. Save results artifact
  const resultsPath = path.resolve(__dirname, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n💾 Saved machine-readable results to ${resultsPath}\n`);
}

// If executed directly from CLI
if (process.argv[1] && (process.argv[1].endsWith('runner.ts') || process.argv[1].endsWith('runner.js'))) {
  runEvaluation().catch(err => {
    console.error('Fatal evaluation runner error:', err);
    process.exit(1);
  });
}
