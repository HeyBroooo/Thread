/**
 * Secret redaction (doc §56.5, §120).
 *
 * Applied to any source material before it leaves the deterministic boundary
 * (AI prompts, logs, telemetry). Never send raw secrets to a model.
 */

const KEY_PATTERNS: Array<[RegExp, string]> = [
  // Assignment-style secrets: API_KEY=..., token: "..."
  [
    /((?:api[_-]?key|secret|token|password|passwd|pwd|private[_-]?key|client[_-]?secret|access[_-]?key)\s*[:=]\s*)(['"`]?)([^\s'"`\n]{4,})\2/gi,
    '$1$2[REDACTED]$2',
  ],
  // Known provider key shapes
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_OPENAI_STYLE_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]'],
  // PEM blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  // JWT-ish
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  // Connection strings with credentials
  [/(\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:@\s]+:)([^@\s]+)(@)/gi, '$1[REDACTED]$3'],
];

export interface RedactionResult {
  text: string;
  redactions: number;
}

export function redactSecrets(input: string): RedactionResult {
  let text = input;
  let redactions = 0;
  for (const [pattern, replacement] of KEY_PATTERNS) {
    text = text.replace(pattern, (...args) => {
      redactions += 1;
      // Support both string and function replacement semantics.
      return replacement.replace(/\$(\d)/g, (_, d: string) => String(args[Number(d)] ?? ''));
    });
  }
  return { text, redactions };
}

export function redact(input: string): string {
  return redactSecrets(input).text;
}

/** Redact an arbitrary object's string values (used for log payloads). */
export function redactObject(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /key|secret|token|password|credential/i.test(k) ? '[REDACTED]' : redactObject(v);
    }
    return out;
  }
  return value;
}
