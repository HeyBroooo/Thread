import { getConfig } from '@cbi/shared';

/**
 * Embeddings are used for semantic retrieval (doc §85). Providers are
 * pluggable; when no embedding API is configured we fall back to a
 * deterministic hashing embedding so the platform still performs semantic-ish
 * retrieval locally without any external dependency.
 */
export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Deterministic bag-of-words hashing embedding (no network, reproducible). */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local-hash-v1';
  readonly dimensions = 384;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const vec = new Float64Array(this.dimensions);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9_$./-]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
    for (const token of tokens) {
      const idx = hash(token) % this.dimensions;
      const sign = hash('sign:' + token) % 2 === 0 ? 1 : -1;
      vec[idx]! += sign;
      // character trigrams give partial credit for near-identifiers
      for (let i = 0; i + 3 <= token.length; i++) {
        const tri = token.slice(i, i + 3);
        const ti = hash(tri) % this.dimensions;
        vec[ti]! += 0.3 * sign;
      }
    }
    return normalize(Array.from(vec));
  }
}

/** OpenAI-compatible embeddings endpoint (also usable for self-hosted models). */
export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    dimensions = 1536,
  ) {
    this.id = `http:${model}`;
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`Embedding request failed: ${res.status}`);
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => d.embedding);
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const config = getConfig();
  const url = process.env.EMBEDDING_BASE_URL;
  const key = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  if (url && key && model) {
    return new HttpEmbeddingProvider(url, key, model, Number(process.env.EMBEDDING_DIM ?? 1536));
  }
  return new LocalHashEmbeddingProvider();
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
