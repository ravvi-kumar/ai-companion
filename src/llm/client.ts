import OpenAI from 'openai';
import { env } from '../config/env.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMGenerateOptions {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' | 'text' };
}

export interface LLMClientConfig {
  apiKey?: string;
  model?: string;
}

export class LLMClient {
  private openai: OpenAI;
  private model: string;

  constructor(config: LLMClientConfig = {}) {
    const apiKey = config.apiKey || env.OPENAI_API_KEY;
    this.model = config.model || env.OPENAI_MODEL;
    this.openai = new OpenAI({ apiKey });
  }

  public getModel(): string {
    return this.model;
  }

  public async generate(options: LLMGenerateOptions): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: options.messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 800,
      response_format: options.responseFormat?.type === 'json_object' ? { type: 'json_object' } : undefined
    });

    return response.choices[0]?.message?.content || '';
  }

  public async *stream(options: LLMGenerateOptions): AsyncGenerator<string, void, unknown> {
    const stream = await this.openai.chat.completions.create({
      model: this.model,
      messages: options.messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 800,
      stream: true
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}
