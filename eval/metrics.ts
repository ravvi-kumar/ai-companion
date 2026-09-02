import { EvaluationScore } from './judge.js';

export interface CategoryMetric {
  total: number;
  passed: number;
  passRate: number;
  avgLlmScore: number | null;
}

export interface EvalRunMetadata {
  model: string;
  embeddingModel: string;
  nodeVersion: string;
  platform: string;
  durationMs: number;
}

export interface EvalSummaryReport {
  timestamp: string;
  metadata?: EvalRunMetadata;
  totalCases: number;
  passedCases: number;
  overallPassRate: number;
  avgLlmJudgeScore: number | null;
  categories: Record<string, CategoryMetric>;
  failures: Array<{ caseId: string; caseName: string; category: string; reasons: string[]; llmJudgeReasoning: string | null }>;
}

export class MetricsReporter {
  public static calculateSummary(scores: EvaluationScore[], metadata?: EvalRunMetadata): EvalSummaryReport {
    const total = scores.length;
    const passed = scores.filter(s => s.passed).length;
    const overallPassRate = total > 0 ? (passed / total) * 100 : 0;

    // Aggregate LLM judge scores (exclude failures where score is -1)
    const validLlmScores = scores.filter(s => s.llmJudgeScore !== null && s.llmJudgeScore >= 0).map(s => s.llmJudgeScore as number);
    const avgLlmJudgeScore = validLlmScores.length > 0
      ? validLlmScores.reduce((a, b) => a + b, 0) / validLlmScores.length
      : null;

    const categories: Record<string, { total: number; passed: number; llmScores: number[] }> = {};
    for (const score of scores) {
      if (!categories[score.category]) {
        categories[score.category] = { total: 0, passed: 0, llmScores: [] };
      }
      categories[score.category].total++;
      if (score.passed) {
        categories[score.category].passed++;
      }
      if (score.llmJudgeScore !== null && score.llmJudgeScore >= 0) {
        categories[score.category].llmScores.push(score.llmJudgeScore);
      }
    }

    const categoryMetrics: Record<string, CategoryMetric> = {};
    for (const [cat, data] of Object.entries(categories)) {
      categoryMetrics[cat] = {
        total: data.total,
        passed: data.passed,
        passRate: data.total > 0 ? (data.passed / data.total) * 100 : 0,
        avgLlmScore: data.llmScores.length > 0
          ? data.llmScores.reduce((a, b) => a + b, 0) / data.llmScores.length
          : null
      };
    }

    const failures = scores
      .filter(s => !s.passed)
      .map(s => ({
        caseId: s.caseId,
        caseName: s.caseName,
        category: s.category,
        reasons: s.failureReasons,
        llmJudgeReasoning: s.llmJudgeReasoning
      }));

    return {
      timestamp: new Date().toISOString(),
      metadata,
      totalCases: total,
      passedCases: passed,
      overallPassRate,
      avgLlmJudgeScore: avgLlmJudgeScore,
      categories: categoryMetrics,
      failures
    };
  }

  public static formatMarkdown(summary: EvalSummaryReport): string {
    let md = `# 📊 AI Companion Evaluation Benchmark Report\n\n`;
    md += `**Execution Date**: ${summary.timestamp.replace('T', ' ').slice(0, 19)} UTC\n`;
    if (summary.metadata) {
      md += `**LLM Model**: \`${summary.metadata.model}\` | **Embeddings**: \`${summary.metadata.embeddingModel}\`\n`;
      md += `**Environment**: Node ${summary.metadata.nodeVersion} on ${summary.metadata.platform} (${(summary.metadata.durationMs / 1000).toFixed(1)}s total run time)\n`;
    }
    md += `**Overall Pass Rate**: **${summary.passedCases} / ${summary.totalCases} (${summary.overallPassRate.toFixed(1)}%)**\n`;
    if (summary.avgLlmJudgeScore !== null) {
      md += `**Average LLM Judge Score**: **${(summary.avgLlmJudgeScore * 100).toFixed(1)}%**\n`;
    }
    md += `\n`;

    md += `## 📈 Category Breakdown\n\n`;
    md += `| Category | Total Tests | Passed | Pass Rate | LLM Judge Avg |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: |\n`;

    for (const [cat, data] of Object.entries(summary.categories)) {
      const formattedName = cat.replace(/_/g, ' ').toUpperCase();
      const llmAvg = data.avgLlmScore !== null ? `${(data.avgLlmScore * 100).toFixed(1)}%` : 'N/A';
      md += `| **${formattedName}** | ${data.total} | ${data.passed} | **${data.passRate.toFixed(1)}%** | ${llmAvg} |\n`;
    }

    md += `\n## 🔍 Failure Analysis\n\n`;
    if (summary.failures.length === 0) {
      md += `✅ **Zero failures detected! All memory, persistence, contradiction, and persona consistency tests passed.**\n`;
    } else {
      md += `Detected ${summary.failures.length} failure(s):\n\n`;
      summary.failures.forEach((f, idx) => {
        md += `### ${idx + 1}. [${f.category}] ${f.caseName} (${f.caseId})\n`;
        f.reasons.forEach(r => {
          md += `- ❌ ${r}\n`;
        });
        if (f.llmJudgeReasoning) {
          md += `- 🤖 LLM Judge: ${f.llmJudgeReasoning}\n`;
        }
        md += `\n`;
      });
    }

    md += `\n## ⚖️ LLM-as-Judge Methodology & Limitations\n\n`;
    md += `The evaluation harness uses a dual-judge approach:\n\n`;
    md += `1. **Keyword Judge** (deterministic): Checks for exact substring matches of expected/forbidden terms. Fast and reproducible, but fragile to paraphrasing.\n`;
    md += `2. **LLM Judge** (probabilistic): Uses GPT-4o-mini with a structured rubric scoring Memory Recall, Stale Avoidance, Persona Consistency, and Naturalness (each 0.0-1.0).\n\n`;
    md += `**Known limitations of the LLM judge:**\n`;
    md += `- Scores are subjective approximations, not ground-truth measurements\n`;
    md += `- The judge model may apply inconsistent standards across runs\n`;
    md += `- Rubric doesn't capture nuance like emotional attunement or humor quality\n`;
    md += `- Judge quality depends on the evaluation model's instruction-following capability\n`;

    return md;
  }
}
