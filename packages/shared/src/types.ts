/**
 * Core graph vocabulary and data contracts shared across the platform.
 *
 * These types are the contract between the deterministic analyzers (which own
 * the truth) and every consumer (graph store, search, AI, canvas, PR review).
 */

export const NODE_TYPES = [
  'repository',
  'folder',
  'file',
  'component',
  'function',
  'hook',
  'class',
  'interface',
  'type',
  'enum',
  'constant',
  'variable',
  'route',
  'api_endpoint',
  'service',
  'store',
  'context',
  'middleware',
  'test',
  'package',
  'configuration',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  'CONTAINS',
  'IMPORTS',
  'EXPORTS',
  'CALLS',
  'REFERENCES',
  'RENDERS',
  'USES',
  'DEPENDS_ON',
  'EXTENDS',
  'IMPLEMENTS',
  'NAVIGATES_TO',
  'CALLS_API',
  'DEFINED_IN',
  'READS',
  'WRITES',
  'USES_CONTEXT',
  'USES_STORE',
  'TESTS',
  // Historical relationships (stored separately from structural truth)
  'CHANGED_WITH',
  'MODIFIED_BY',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

/** Edge categories so consumers can reason about semantic weight (doc §98). */
export const STRUCTURAL_EDGES: readonly EdgeType[] = ['IMPORTS', 'EXPORTS', 'CONTAINS', 'DEFINED_IN'];
export const BEHAVIORAL_EDGES: readonly EdgeType[] = [
  'CALLS',
  'RENDERS',
  'USES',
  'READS',
  'WRITES',
  'CALLS_API',
];
export const ARCHITECTURAL_EDGES: readonly EdgeType[] = ['DEPENDS_ON', 'IMPLEMENTS', 'EXTENDS'];
export const HISTORICAL_EDGES: readonly EdgeType[] = ['CHANGED_WITH', 'MODIFIED_BY'];

export function isStructuralEdge(t: EdgeType): boolean {
  return STRUCTURAL_EDGES.includes(t);
}

export interface GraphNode {
  id: string;
  repositoryId: string;
  nodeType: NodeType;
  name: string;
  qualifiedName: string;
  filePath: string | null;
  language: string | null;
  startLine: number | null;
  endLine: number | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  repositoryId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: EdgeType;
  sourceFile: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
  evidence: string;
  extractionMethod: ExtractionMethod;
  confidence: number;
  metadata: Record<string, unknown>;
}

export type ExtractionMethod =
  | 'typescript_ast'
  | 'ts_morph'
  | 'framework_convention'
  | 'config_analysis'
  | 'git_history'
  | 'static_inference'
  | 'unresolved_dynamic';

export type IndexStatus =
  | 'CONNECTED'
  | 'QUEUED'
  | 'INDEXING'
  | 'PARTIAL'
  | 'READY'
  | 'STALE'
  | 'FAILED';

/**
 * Indexing job state machine (doc §21). Ordered so progress can be computed
 * as (position / total).
 */
export const INDEX_STAGES = [
  'QUEUED',
  'CLONING',
  'DISCOVERING',
  'PARSING',
  'RESOLVING',
  'FRAMEWORK_ANALYSIS',
  'API_ANALYSIS',
  'GIT_ANALYSIS',
  'SEMANTIC_INDEXING',
  'VALIDATING',
  'READY',
] as const;

export type IndexStage = (typeof INDEX_STAGES)[number] | 'FAILED';

export interface IndexingJobProgress {
  jobId: string;
  repositoryId: string;
  commitSha: string;
  status: IndexStatus;
  stage: IndexStage;
  progress: number;
  filesProcessed: number;
  filesTotal: number;
  nodesCreated: number;
  edgesCreated: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface RepositoryRef {
  id: string;
  organizationId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  branch: string;
  indexedCommitSha: string | null;
  indexStatus: IndexStatus;
  parserVersion: string;
  graphSchemaVersion: number;
}

/** A source slice used as evidence for a relationship or an answer. */
export interface SourceEvidence {
  nodeId: string | null;
  filePath: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  snippet: string;
}

/** Chat answer contract (doc §26). */
export interface ChatAnswer {
  answer: string;
  references: SourceEvidence[];
  relationships: Array<{ from: string; relationship: EdgeType; to: string }>;
  canvasPath: string[];
  confidence: number;
  /** True when the repository graph was only partially available. */
  partial: boolean;
  /** Set when the model could not ground the answer in evidence. */
  unverified?: boolean;
}

export interface SearchResult {
  nodeId: string;
  nodeType: NodeType;
  name: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  score: number;
  scores: {
    exact: number;
    path: number;
    text: number;
    semantic: number;
    graph: number;
  };
}

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Finding {
  severity: Severity;
  category: string;
  file: string;
  line: number;
  title: string;
  explanation: string;
  suggestion?: string;
  confidence: number;
  evidence?: string;
  /** Which analyzer produced the finding. */
  analyzer?: string;
  /** Deterministic findings are always allowed; AI findings must be validated. */
  origin?: 'deterministic' | 'ai';
}

export const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high', 'critical'];

/** Impact classification for PR analysis (doc §36). */
export type ImpactClass = 'DIRECT' | 'INDIRECT' | 'UNRELATED';

export interface ImpactNode {
  nodeId: string;
  name: string;
  nodeType: NodeType;
  filePath: string | null;
  impact: ImpactClass;
  distance: number;
}
