import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { LLMClient } from '../src/llm/client.js';

function makeFakeOpenAI() {
  const create = vi.fn(async (_body: Record<string, unknown>) => ({ output_text: 'hello from responses' }));
  async function* fakeStream(_body: Record<string, unknown>) {
    yield { type: 'response.output_text.delta', delta: 'hello ' };
    yield { type: 'response.output_text.delta', delta: 'world' };
    yield { type: 'response.completed' };
  }
  const stream = vi.fn(fakeStream);
  return {
    fake: { responses: { create, stream } } as unknown as OpenAI,
    create,
    stream
  };
}

describe('LLMClient (Responses API)', () => {
  it('maps system messages to instructions and the rest to input items', async () => {
    const { fake, create } = makeFakeOpenAI();
    const client = new LLMClient({ apiKey: 'test-key', model: 'gpt-4o-mini', openaiClient: fake });

    const text = await client.generate({
      messages: [
        { role: 'system', content: 'You are Maya.' },
        { role: 'user', content: 'Hi!' }
      ]
    });

    expect(text).toBe('hello from responses');
    expect(create).toHaveBeenCalledOnce();
    const body = create.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-4o-mini',
      instructions: 'You are Maya.',
      input: [{ role: 'user', content: 'Hi!' }],
      store: false
    });
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('response_format');
  });

  it('maps maxTokens to max_output_tokens and json_object to text.format', async () => {
    const { fake, create } = makeFakeOpenAI();
    const client = new LLMClient({ apiKey: 'test-key', openaiClient: fake });

    await client.generate({
      messages: [
        { role: 'system', content: 'Output strictly a JSON object.' },
        { role: 'user', content: 'extract' }
      ],
      temperature: 0.1,
      maxTokens: 500,
      responseFormat: { type: 'json_object' }
    });

    const body = create.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({
      temperature: 0.1,
      max_output_tokens: 500,
      // Full transcript stays in input so the API's "json" gate (which only
      // scans input items) is satisfied by the system message.
      input: [
        { role: 'system', content: 'Output strictly a JSON object.' },
        { role: 'user', content: 'extract' }
      ],
      text: { format: { type: 'json_object' } }
    });
    expect(body).not.toHaveProperty('instructions');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('preserves multi-turn history order in input and streams text deltas', async () => {
    const { fake, create, stream } = makeFakeOpenAI();
    const client = new LLMClient({ apiKey: 'test-key', openaiClient: fake });

    const chunks: string[] = [];
    for await (const chunk of client.stream({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' }
      ]
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('hello world');
    const body = stream.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({
      instructions: 'sys',
      input: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' }
      ]
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('forwards previousResponseId for opt-in server-side chaining', async () => {
    const { fake, create } = makeFakeOpenAI();
    const client = new LLMClient({ apiKey: 'test-key', openaiClient: fake });

    await client.generate({
      messages: [{ role: 'user', content: 'follow-up' }],
      previousResponseId: 'resp_123',
      store: true
    });

    const body = create.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ previous_response_id: 'resp_123', store: true });
  });
});
