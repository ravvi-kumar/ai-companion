import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

export const EnvSchema = z.object({
  OPENAI_API_KEY: z
    .string({
      required_error: 'OPENAI_API_KEY is required in environment variables (.env)',
      invalid_type_error: 'OPENAI_API_KEY must be a string'
    })
    .min(1, 'OPENAI_API_KEY is required and cannot be empty'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  DATABASE_PATH: z.string().default('./data/companion.db')
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(environment: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(environment);
  if (!result.success) {
    const errorMessages = result.error.errors
      .map(err => `  • ${err.path.length > 0 ? err.path.join('.') : 'environment'}: ${err.message}`)
      .join('\n');
    throw new Error(
      `\n❌ [Configuration Error] Missing or invalid environment variables:\n${errorMessages}\n\nPlease check your .env file or set the required environment variables.\n`
    );
  }
  return result.data;
}

let _cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!_cachedEnv) {
    _cachedEnv = validateEnv(process.env);
  }
  return _cachedEnv;
}

/**
 * Reset the cached env (useful for tests that modify process.env)
 */
export function resetEnvCache(): void {
  _cachedEnv = null;
}

// Convenient export for direct access (cached after first access)
export const env = {
  get OPENAI_API_KEY(): string {
    return getEnv().OPENAI_API_KEY;
  },
  get OPENAI_MODEL(): string {
    return getEnv().OPENAI_MODEL;
  },
  get OPENAI_EMBEDDING_MODEL(): string {
    return getEnv().OPENAI_EMBEDDING_MODEL;
  },
  get DATABASE_PATH(): string {
    return getEnv().DATABASE_PATH;
  }
};
