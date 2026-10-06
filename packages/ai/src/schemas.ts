import { z } from 'zod';
import { EDGE_TYPES, SEVERITIES } from '@cbi/shared';

/** Chat answer contract (doc §26). */
export const ReferenceSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbol: z.string().nullable().optional(),
});

export const RelationshipSchema = z.object({
  from: z.string(),
  relationship: z.string(),
  to: z.string(),
});

export const ChatAnswerSchema = z.object({
  answer: z.string(),
  references: z.array(ReferenceSchema).default([]),
  relationships: z.array(RelationshipSchema).default([]),
  confidence: z.number().min(0).max(1),
  /** Set by the model when the indexed evidence is insufficient. */
  unverified: z.boolean().optional(),
});
export type RawChatAnswer = z.infer<typeof ChatAnswerSchema>;

/** PR finding contract (doc §39). */
export const PRFindingSchema = z.object({
  severity: z.enum(SEVERITIES as unknown as [string, ...string[]]),
  category: z.string().min(1),
  file: z.string(),
  line: z.number().int().positive(),
  title: z.string().min(1).max(200),
  explanation: z.string().min(1),
  suggestion: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().optional(),
});

export const PRFindingsSchema = z.object({
  findings: z.array(PRFindingSchema).max(25).default([]),
  summary: z.string().optional(),
});
export type RawPRFindings = z.infer<typeof PRFindingsSchema>;

export function isValidEdgeType(value: string): boolean {
  return (EDGE_TYPES as readonly string[]).includes(value.toUpperCase());
}
