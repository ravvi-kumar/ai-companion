import { z } from 'zod';

export const MemoryClassSchema = z.enum([
  'WORKING',
  'EPISODIC',
  'SEMANTIC'
]);

export type MemoryClass = z.infer<typeof MemoryClassSchema>;

export const MemoryTypeSchema = z.enum([
  'fact',
  'preference',
  'relationship',
  'goal',
  'plan',
  'occupation',
  'location',
  'habit',
  'life_event',
  'health',
  'state',
  'activity'
]);

export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryStatusSchema = z.enum([
  'ACTIVE',
  'SUPERSEDED',
  'EXPIRED',
  'DISCARDED'
]);

export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

/**
 * Schema for ISO-8601 date inputs normalized to UTC ISO strings
 */
export const IsoDateSchema = z.string()
  .refine((val) => !isNaN(Date.parse(val)), { message: 'Must be a valid ISO-8601 timestamp' })
  .transform((val) => new Date(val).toISOString())
  .optional()
  .nullable();

export const MemoryCandidateSchema = z.object({
  type: MemoryTypeSchema,
  memory_class: MemoryClassSchema.default('SEMANTIC'),
  subject: z.string().default('user'),
  key: z.string().min(1).describe('Canonical snake_case attribute identifier, e.g., employer, city, favorite_drink, current_health_issue, upcoming_meeting'),
  value: z.string().min(1).describe('The concise extracted fact, state, or event value'),
  confidence: z.number().min(0).max(1).default(0.9),
  importance: z.number().min(0).max(1).default(0.5),
  valid_from: IsoDateSchema.describe('ISO timestamp from which the memory becomes valid'),
  valid_until: IsoDateSchema.describe('ISO timestamp until which the memory remains valid'),
  expires_at: IsoDateSchema.describe('ISO timestamp after which memory should decay and expire'),
  embedding: z.array(z.number()).optional().nullable().describe('Pre-computed embedding vector for semantic similarity')
});

export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
export type MemoryCandidateInput = z.input<typeof MemoryCandidateSchema>;

/**
 * Schema for array of extracted candidates from LLM output
 */
export const ExtractedMemoriesResponseSchema = z.object({
  memories: z.array(MemoryCandidateSchema).default([])
});

export type ExtractedMemoriesResponse = z.infer<typeof ExtractedMemoriesResponseSchema>;

/**
 * Full stored memory record inside SQLite
 */
export interface MemoryRecord {
  id: string;
  type: MemoryType;
  memory_class: MemoryClass;
  subject: string;
  key: string;
  value: string;
  confidence: number;
  importance: number;
  status: MemoryStatus;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  embedding: number[] | null;
  source_message_id: string | null;
  superseded_by: string | null;
}

