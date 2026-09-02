import OpenAI from 'openai';
import { env } from '../config/env.js';

export class EmbeddingService {
  private openai: OpenAI;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || env.OPENAI_API_KEY;
    this.model = model || env.OPENAI_EMBEDDING_MODEL;
    this.openai = new OpenAI({ apiKey: key });
  }

  public async getEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text.replace(/\n/g, ' ')
    });
    return response.data[0].embedding;
  }

  public async getEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.openai.embeddings.create({
      model: this.model,
      input: texts.map(t => t.replace(/\n/g, ' '))
    });
    return response.data.map(d => d.embedding);
  }

  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
