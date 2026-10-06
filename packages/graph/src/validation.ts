import { EDGE_TYPES, NODE_TYPES, type EdgeType, type GraphEdge, type GraphNode, type NodeType } from '@cbi/shared';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationReport {
  status: 'passed' | 'failed';
  errors: number;
  warnings: number;
  unresolvedImports: number;
  orphanNodes: number;
  issues: ValidationIssue[];
}

export interface ValidationOptions {
  /** Import edges whose resolution failed are counted by the parser, passed in here. */
  unresolvedImports?: number;
  /** Treat warnings as fatal. */
  strict?: boolean;
  maxIssues?: number;
}

export function validateGraph(
  graph: { repositoryId: string; nodes: GraphNode[]; edges: GraphEdge[] },
  options: ValidationOptions = {},
): ValidationReport {
  const maxIssues = options.maxIssues ?? 500;
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const nodeById = new Map<string, GraphNode>();
  const connected = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ level: 'error', code: 'DUPLICATE_NODE', message: `Duplicate node id ${node.id}`, nodeId: node.id });
      continue;
    }
    nodeIds.add(node.id);
    nodeById.set(node.id, node);

    if (node.repositoryId !== graph.repositoryId) {
      issues.push({
        level: 'error',
        code: 'INVALID_OWNERSHIP',
        message: `Node ${node.id} belongs to ${node.repositoryId}, expected ${graph.repositoryId}`,
        nodeId: node.id,
      });
    }
    if (!NODE_TYPES.includes(node.nodeType as NodeType)) {
      issues.push({ level: 'error', code: 'INVALID_NODE_TYPE', message: `Unknown node type ${node.nodeType}`, nodeId: node.id });
    }
    if (node.startLine != null && node.endLine != null && node.endLine < node.startLine) {
      issues.push({
        level: 'error',
        code: 'INVALID_SOURCE_LOCATION',
        message: `${node.name}: endLine ${node.endLine} < startLine ${node.startLine}`,
        nodeId: node.id,
      });
    }
    if (node.startLine != null && node.startLine <= 0) {
      issues.push({ level: 'warning', code: 'INVALID_SOURCE_LOCATION', message: `${node.name}: startLine <= 0`, nodeId: node.id });
    }
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.sourceNodeId)) {
      issues.push({
        level: 'error',
        code: 'INVALID_EDGE_ENDPOINT',
        message: `Edge ${edge.id} source node ${edge.sourceNodeId} does not exist`,
        edgeId: edge.id,
      });
      continue;
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      issues.push({
        level: 'error',
        code: 'INVALID_EDGE_ENDPOINT',
        message: `Edge ${edge.id} target node ${edge.targetNodeId} does not exist`,
        edgeId: edge.id,
      });
      continue;
    }
    connected.add(edge.sourceNodeId);
    connected.add(edge.targetNodeId);

    if (!EDGE_TYPES.includes(edge.edgeType as EdgeType)) {
      issues.push({ level: 'error', code: 'INVALID_EDGE_TYPE', message: `Unknown edge type ${edge.edgeType}`, edgeId: edge.id });
    }
    if (edge.confidence < 0 || edge.confidence > 1) {
      issues.push({ level: 'error', code: 'INVALID_CONFIDENCE', message: `Edge ${edge.id} confidence ${edge.confidence} out of range`, edgeId: edge.id });
    }
    if (!edge.evidence || edge.evidence.trim().length === 0) {
      issues.push({ level: 'warning', code: 'MISSING_EVIDENCE', message: `Edge ${edge.id} (${edge.edgeType}) has no evidence`, edgeId: edge.id });
    }
    if (edge.repositoryId !== graph.repositoryId) {
      issues.push({ level: 'error', code: 'INVALID_OWNERSHIP', message: `Edge ${edge.id} has foreign repositoryId`, edgeId: edge.id });
    }
  }

  const ignorableOrphanTypes = new Set<NodeType>(['repository', 'folder', 'configuration', 'package']);
  let orphanNodes = 0;
  for (const node of graph.nodes) {
    if (ignorableOrphanTypes.has(node.nodeType)) continue;
    if (!connected.has(node.id)) {
      orphanNodes++;
      if (issues.length < maxIssues) {
        issues.push({ level: 'warning', code: 'ORPHAN_NODE', message: `Node ${node.name} (${node.nodeType}) has no relationships`, nodeId: node.id });
      }
    }
  }

  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  const failed = errors > 0 || (options.strict === true && warnings > 0);

  return {
    status: failed ? 'failed' : 'passed',
    errors,
    warnings,
    unresolvedImports: options.unresolvedImports ?? 0,
    orphanNodes,
    issues: issues.slice(0, maxIssues),
  };
}
