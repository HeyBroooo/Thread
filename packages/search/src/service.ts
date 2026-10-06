import type { GraphEdge, GraphNode, NodeType, SearchResult } from '@cbi/shared';
import { humanize, normalizePath } from '@cbi/shared';
import { loadGraphView, type GraphStore } from '@cbi/graph';
import { cosineSimilarity, getEmbeddingProvider, normalize, type EmbeddingProvider } from './embedding.js';

/** Document types that participate in semantic retrieval (doc §85). */
const DOCUMENTED_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'file',
  'component',
  'hook',
  'function',
  'service',
  'class',
  'route',
  'api_endpoint',
  'context',
  'store',
  'middleware',
  'test',
]);

export interface RankingWeights {
  exact: number;
  path: number;
  text: number;
  semantic: number;
  graph: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  exact: 0.3,
  path: 0.15,
  text: 0.1,
  semantic: 0.25,
  graph: 0.2,
};

interface IndexedDocument {
  node: GraphNode;
  text: string;
  tokens: string[];
  vector: number[];
}

interface RepositoryIndex {
  repositoryId: string;
  documents: IndexedDocument[];
  byNodeId: Map<string, IndexedDocument>;
  adjacency: Map<string, Set<string>>;
  providerId: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 1);
}

function buildDocumentText(node: GraphNode, relatedEvidence: string[]): string {
  const parts = [
    node.name,
    humanize(node.name),
    node.nodeType,
    node.qualifiedName,
    node.filePath ?? '',
    node.filePath ? normalizePath(node.filePath).split('/').join(' ') : '',
    ...relatedEvidence,
  ];
  return parts.filter(Boolean).join(' \n ');
}

export interface SearchOptions {
  mode?: 'hybrid' | 'exact' | 'semantic' | 'text';
  limit?: number;
  weights?: Partial<RankingWeights>;
  nodeTypes?: NodeType[];
}

export class SearchService {
  private indexes = new Map<string, RepositoryIndex>();
  private provider: EmbeddingProvider | null = null;

  constructor(private store: GraphStore, provider?: EmbeddingProvider) {
    this.provider = provider ?? null;
  }

  private getProvider(): EmbeddingProvider {
    if (!this.provider) this.provider = getEmbeddingProvider();
    return this.provider;
  }

  invalidate(repositoryId?: string): void {
    if (repositoryId) this.indexes.delete(repositoryId);
    else this.indexes.clear();
  }

  async getIndex(repositoryId: string): Promise<RepositoryIndex> {
    const existing = this.indexes.get(repositoryId);
    if (existing) return existing;

    const { nodes, edges } = await loadGraphView(this.store, repositoryId);
    const evidenceByNode = new Map<string, string[]>();
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      const label =
        edge.edgeType === 'CALLS_API' || edge.edgeType === 'CALLS' || edge.edgeType === 'RENDERS' || edge.edgeType === 'USES'
          ? edge.evidence
          : '';
      if (label) {
        push(evidenceByNode, edge.sourceNodeId, label);
        push(evidenceByNode, edge.targetNodeId, label);
      }
      link(adjacency, edge.sourceNodeId, edge.targetNodeId);
      link(adjacency, edge.targetNodeId, edge.sourceNodeId);
    }

    const docNodes = nodes.filter((n) => DOCUMENTED_TYPES.has(n.nodeType));
    const texts = docNodes.map((n) => buildDocumentText(n, (evidenceByNode.get(n.id) ?? []).slice(0, 6)));
    const provider = this.getProvider();
    const vectors = await provider.embed(texts.map((t) => t.slice(0, 4000)));

    const documents: IndexedDocument[] = docNodes.map((node, i) => ({
      node,
      text: texts[i]!,
      tokens: tokenize(texts[i]!),
      vector: vectors[i] ?? [],
    }));

    const index: RepositoryIndex = {
      repositoryId,
      documents,
      byNodeId: new Map(documents.map((d) => [d.node.id, d])),
      adjacency,
      providerId: provider.id,
    };
    this.indexes.set(repositoryId, index);
    return index;
  }

  async search(repositoryId: string, query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const index = await this.getIndex(repositoryId);
    const weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
    const mode = options.mode ?? 'hybrid';
    const limit = options.limit ?? 20;
    const q = query.trim();
    const qLower = q.toLowerCase();
    const qTokens = tokenize(q);

    let queryVector: number[] = [];
    if (mode === 'hybrid' || mode === 'semantic') {
      const [v] = await this.getProvider().embed([q]);
      queryVector = v ?? [];
    }

    // Exact anchors drive graph relevance.
    const anchors = new Set<string>();
    for (const doc of index.documents) {
      if (doc.node.name.toLowerCase() === qLower) anchors.add(doc.node.id);
    }

    const scored = index.documents
      .filter((d) => !options.nodeTypes || options.nodeTypes.includes(d.node.nodeType))
      .map((doc) => {
        const exact = computeExact(doc.node, qLower, qTokens);
        const pathScore = computePath(doc.node, qTokens);
        const textScore = mode === 'exact' ? 0 : computeText(doc, qTokens);
        const semantic = queryVector.length ? Math.max(0, cosineSimilarity(queryVector, doc.vector)) : 0;
        const graphScore = computeGraph(doc.node.id, anchors, index.adjacency);

        const final =
          mode === 'exact'
            ? exact
            : mode === 'semantic'
              ? semantic
              : mode === 'text'
                ? textScore
                : exact * weights.exact +
                  pathScore * weights.path +
                  textScore * weights.text +
                  semantic * weights.semantic +
                  graphScore * weights.graph;

        return { doc, exact, pathScore, textScore, semantic, graphScore, final };
      })
      .filter((s) => s.final > 0.01)
      .sort((a, b) => b.final - a.final)
      .slice(0, limit);

    return scored.map((s) => ({
      nodeId: s.doc.node.id,
      nodeType: s.doc.node.nodeType,
      name: s.doc.node.name,
      filePath: s.doc.node.filePath,
      startLine: s.doc.node.startLine,
      endLine: s.doc.node.endLine,
      score: Number(s.final.toFixed(4)),
      scores: {
        exact: Number(s.exact.toFixed(4)),
        path: Number(s.pathScore.toFixed(4)),
        text: Number(s.textScore.toFixed(4)),
        semantic: Number(s.semantic.toFixed(4)),
        graph: Number(s.graphScore.toFixed(4)),
      },
    }));
  }

  /** Convenience: resolve the single best anchor node for a question. */
  async bestAnchor(repositoryId: string, query: string): Promise<SearchResult | null> {
    const results = await this.search(repositoryId, query, { limit: 1 });
    return results[0] ?? null;
  }
}

function computeExact(node: GraphNode, qLower: string, qTokens: string[]): number {
  const name = node.name.toLowerCase();
  if (name === qLower) return 1;
  if (name.includes(qLower) && qLower.length >= 3) return 0.85;
  const tokens = tokenize(node.name);
  if (qTokens.length && qTokens.every((t) => tokens.some((nt) => nt === t || nt.startsWith(t)))) return 0.8;
  let hits = 0;
  for (const t of qTokens) if (tokens.some((nt) => nt === t)) hits++;
  if (qTokens.length) return (hits / qTokens.length) * 0.6;
  return 0;
}

function computePath(node: GraphNode, qTokens: string[]): number {
  if (!node.filePath || qTokens.length === 0) return 0;
  const pathTokens = tokenize(node.filePath);
  let hits = 0;
  for (const t of qTokens) if (pathTokens.some((pt) => pt === t || pt.includes(t))) hits++;
  return hits / qTokens.length;
}

function computeText(doc: IndexedDocument, qTokens: string[]): number {
  if (qTokens.length === 0) return 0;
  const tokenCounts = new Map<string, number>();
  for (const t of doc.tokens) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
  let score = 0;
  for (const t of qTokens) {
    let hit = tokenCounts.get(t) ?? 0;
    if (hit === 0) {
      for (const [token, count] of tokenCounts) {
        if (token.startsWith(t)) {
          hit = count * 0.5;
          break;
        }
      }
    }
    if (hit > 0) score += 1 + Math.log(1 + hit);
  }
  return Math.min(1, score / (qTokens.length * 2));
}

function computeGraph(nodeId: string, anchors: Set<string>, adjacency: Map<string, Set<string>>): number {
  if (anchors.size === 0) return 0;
  if (anchors.has(nodeId)) return 1;
  const neighbors = adjacency.get(nodeId);
  if (!neighbors) return 0;
  let hits = 0;
  for (const a of anchors) if (neighbors.has(a)) hits++;
  return hits > 0 ? Math.min(1, 0.5 + 0.25 * hits) : 0;
}

function link(map: Map<string, Set<string>>, a: string, b: string): void {
  const set = map.get(a);
  if (set) set.add(b);
  else map.set(a, new Set([b]));
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export { normalize };
