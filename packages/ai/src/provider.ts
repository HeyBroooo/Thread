import type { z } from 'zod';

/** Provider-agnostic request (doc §28). */
export interface AIRequest {
  system: string;
  context: string;
  user: string;
  /** JSON schema the model should conform to (documented in the prompt). */
  schema?: unknown;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for strict JSON output when supported. */
  json?: boolean;
}

export interface AIUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AIResult {
  text: string;
  model: string;
  usage: AIUsage;
}

export interface AIProvider {
  readonly id: string;
  readonly defaultModel: string;
  complete(request: AIRequest): Promise<AIResult>;
}

/** A provider failed in a way that may succeed on retry (429/timeout/5xx). */
export class RetryableAIError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'RetryableAIError';
  }
}

/** A provider failed permanently (bad request, invalid key, malformed schema). */
export class FatalAIError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FatalAIError';
  }
}

export interface StructuredOptions<S extends z.ZodTypeAny> {
  schema: S;
  /** Attempt to repair common JSON issues before giving up. */
  repair?: boolean;
}

export interface StructuredResult<T> {
  data: T;
  raw: string;
  model: string;
  usage: AIUsage;
}

/** Extract the first balanced JSON object/array from a model response. */
export function extractJson(text: string): string | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : trimmed;
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const openChar = candidate[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

export async function generateStructured<S extends z.ZodTypeAny>(
  provider: AIProvider,
  request: AIRequest,
  options: StructuredOptions<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const result = await provider.complete({ ...request, json: true });
  const jsonText = extractJson(result.text);
  if (!jsonText) {
    throw new FatalAIError('Model response did not contain JSON.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    if (options.repair === false) throw new FatalAIError('Model returned malformed JSON.');
    parsed = JSON.parse(repairJson(jsonText));
  }
  const validated = options.schema.safeParse(parsed);
  if (!validated.success) {
    throw new FatalAIError('Model JSON did not match the required schema: ' + validated.error.message);
  }
  return { data: validated.data, raw: result.text, model: result.model, usage: result.usage };
}

/** Best-effort repair for trailing commas and unquoted control characters. */
export function repairJson(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u0000-\u001f]/g, (m) => (m === '\n' || m === '\t' ? m : ' '));
}
