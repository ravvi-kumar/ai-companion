import { describe, it, expect } from 'vitest';
import { validateEnv, EnvSchema } from '../src/config/env.js';

describe('Environment & Zod Configuration Validation', () => {
  it('throws a descriptive validation error when OPENAI_API_KEY is missing or empty', () => {
    expect(() => {
      validateEnv({});
    }).toThrow(/OPENAI_API_KEY is required/i);

    expect(() => {
      validateEnv({ OPENAI_API_KEY: '' });
    }).toThrow(/OPENAI_API_KEY is required and cannot be empty/i);
  });

  it('validates and supplies default configuration values when OPENAI_API_KEY is present', () => {
    const parsed = validateEnv({
      OPENAI_API_KEY: 'sk-test-valid-key-12345'
    });

    expect(parsed.OPENAI_API_KEY).toBe('sk-test-valid-key-12345');
    expect(parsed.OPENAI_MODEL).toBe('gpt-4o-mini');
    expect(parsed.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(parsed.DATABASE_PATH).toBe('./data/companion.db');
  });

  it('allows overriding model, embedding model, and database path', () => {
    const parsed = validateEnv({
      OPENAI_API_KEY: 'sk-custom-key',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
      DATABASE_PATH: './data/custom.db'
    });

    expect(parsed.OPENAI_API_KEY).toBe('sk-custom-key');
    expect(parsed.OPENAI_MODEL).toBe('gpt-4o');
    expect(parsed.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-large');
    expect(parsed.DATABASE_PATH).toBe('./data/custom.db');
  });
});
