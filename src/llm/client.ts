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
  /**
   * Optional Responses `previous_response_id` for server-side conversation chaining.
   * Unset by default: this app manages conversation state itself (SQLite is the
   * canonical store and history is passed explicitly with `store: false`), so the
   * dedicated Conversations API object is intentionally not used — it would duplicate
   * session state (`/new`, `/switch`, `/clear`) and break eval-case isolation.
   */
  previousResponseId?: string | null;
  /** Server-side response retention. Defaults to false (local SQLite persists). */
  store?: boolean;
}

export interface LLMClientConfig {
  apiKey?: string;
  model?: string;
  /** Injectable OpenAI client (used by tests to avoid network calls). */
  openaiClient?: OpenAI;
}

export class LLMClient {
  private openai: OpenAI;
  private model: string;

  constructor(config: LLMClientConfig = {}) {
    const apiKey = config.apiKey || env.OPENAI_API_KEY;
    this.model = config.model || env.OPENAI_MODEL;
    this.openai = config.openaiClient ?? new OpenAI({ apiKey });
  }

  public getModel(): string {
    return this.model;
  }

  /**
   * Split Chat-style messages into Responses primitives: system guidance becomes
   * top-level `instructions`, everything else becomes `input` items (order kept).
   * Simple message inputs are wire-compatible between the two APIs.
   *
   * Exception: for `json_object` output the full transcript (including system
   * messages) is passed as `input` with no top-level `instructions`, because the
   * API requires the word "json" to appear in `input` items — system guidance
   * moved to `instructions` is not scanned and stateless classifiers (conflict
   * resolver, judge) don't repeat it in their user turn.
   */
  private splitMessages(messages: LLMMessage[], forJsonOutput: boolean): {
    instructions: string | undefined;
    input: OpenAI.Responses.ResponseInput;
  } {
    if (forJsonOutput) {
      const input = messages.map(m => ({
        role: m.role,
        content: m.content
      })) as OpenAI.Responses.ResponseInput;
      return { instructions: undefined, input };
    }
    const systemContents = messages.filter(m => m.role === 'system').map(m => m.content);
    const instructions = systemContents.length > 0 ? systemContents.join('\n\n') : undefined;
    const input = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content })) as OpenAI.Responses.ResponseInput;
    return { instructions, input };
  }

  private buildRequest(options: LLMGenerateOptions): OpenAI.Responses.ResponseCreateParamsNonStreaming {
    const forJsonOutput = options.responseFormat?.type === 'json_object';
    const { instructions, input } = this.splitMessages(options.messages, forJsonOutput);
    return {
      model: this.model,
      ...(instructions !== undefined ? { instructions } : {}),
      input: input.length > 0 ? input : '',
      temperature: options.temperature ?? 0.7,
      max_output_tokens: options.maxTokens ?? 800,
      store: options.store ?? false,
      ...(options.previousResponseId ? { previous_response_id: options.previousResponseId } : {}),
      // Chat `response_format: { type: 'json_object' }` -> Responses `text.format`
      ...(options.responseFormat?.type === 'json_object' ? { text: { format: { type: 'json_object' } } } : {})
    };
  }

  public async generate(options: LLMGenerateOptions): Promise<string> {
    const response = await this.openai.responses.create(this.buildRequest(options));

    return response.output_text || '';
  }

  public async *stream(options: LLMGenerateOptions): AsyncGenerator<string, void, unknown> {
    const stream = this.openai.responses.stream({
      ...this.buildRequest(options),
      stream: true
    });

    for await (const event of stream) {
      // Text deltas arrive as `response.output_text.delta` events (`delta: string`)
      const delta = (event as { delta?: unknown }).delta;
      if (typeof delta === 'string' && delta.length > 0) {
        yield delta;
      }
    }
  }
}
