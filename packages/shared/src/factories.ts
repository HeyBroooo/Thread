import { edgeId, nodeId, qualifiedSymbolName } from './ids.js';
import type { EdgeType, ExtractionMethod, GraphEdge, GraphNode, NodeType } from './types.js';

export interface NodeInput {
  repositoryId: string;
  nodeType: NodeType;
  name: string;
  filePath?: string | null;
  language?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  contentHash?: string | null;
  qualifiedName?: string;
  metadata?: Record<string, unknown>;
}

export function makeNode(input: NodeInput): GraphNode {
  const filePath = input.filePath ?? null;
  const qualifiedName =
    input.qualifiedName ?? (filePath ? qualifiedSymbolName(filePath, input.name) : input.name);
  // `endLine >= startLine` is a graph invariant that validation enforces as a
  // hard error, so normalize here — empty files report lineCount 0, and parsers
  // can emit 0-based ends. Never let a well-meaning producer fail a whole index.
  const startLine = input.startLine ?? null;
  const endLine =
    startLine != null && input.endLine != null ? Math.max(input.endLine, startLine) : (input.endLine ?? null);
  return {
    id: nodeId(input.repositoryId, input.nodeType, qualifiedName, filePath),
    repositoryId: input.repositoryId,
    nodeType: input.nodeType,
    name: input.name,
    qualifiedName,
    filePath,
    language: input.language ?? null,
    startLine,
    endLine,
    contentHash: input.contentHash ?? null,
    metadata: input.metadata ?? {},
  };
}

export interface EdgeInput {
  repositoryId: string;
  edgeType: EdgeType;
  sourceNodeId: string;
  targetNodeId: string;
  evidence: string;
  confidence?: number;
  extractionMethod?: ExtractionMethod;
  sourceFile?: string | null;
  sourceLine?: number | null;
  sourceColumn?: number | null;
  metadata?: Record<string, unknown>;
}

export function makeEdge(input: EdgeInput): GraphEdge {
  return {
    id: edgeId(
      input.repositoryId,
      input.edgeType,
      input.sourceNodeId,
      input.targetNodeId,
      input.sourceFile ?? null,
      input.sourceLine ?? null,
    ),
    repositoryId: input.repositoryId,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    edgeType: input.edgeType,
    sourceFile: input.sourceFile ?? null,
    sourceLine: input.sourceLine ?? null,
    sourceColumn: input.sourceColumn ?? null,
    evidence: input.evidence,
    extractionMethod: input.extractionMethod ?? 'typescript_ast',
    confidence: input.confidence ?? 1.0,
    metadata: input.metadata ?? {},
  };
}

/** Confidence tiers from doc §17. */
export const CONFIDENCE = {
  deterministic: 1.0,
  strongStatic: 0.95,
  probable: 0.8,
  weak: 0.6,
} as const;
