import { createHash, randomUUID } from 'node:crypto';

export function sha256(input: string): string {
  return 'sha256:' + createHash('sha256').update(input).digest('hex');
}

export function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

export function uuid(): string {
  return randomUUID();
}

export function prefixedId(prefix: string, seed: string): string {
  return `${prefix}_${shortHash(seed)}`;
}

/** Stable id for a graph node so incremental reindexing produces identical ids. */
export function nodeId(repositoryId: string, nodeType: string, qualifiedName: string, filePath?: string | null): string {
  return prefixedId('node', `${repositoryId}|${nodeType}|${qualifiedName}|${filePath ?? ''}`);
}

/**
 * Canonical qualified name for a symbol. Both the graph builder and the
 * framework analyzer use this so node ids agree without coordination.
 */
export function qualifiedSymbolName(filePath: string, name: string): string {
  return `${filePath.replace(/\\/g, '/')}#${name}`;
}

/** Stable id for a symbol node belonging to a file. */
export function symbolNodeId(
  repositoryId: string,
  nodeType: string,
  filePath: string,
  name: string,
): string {
  return nodeId(repositoryId, nodeType, qualifiedSymbolName(filePath, name), filePath);
}

/** Stable id for a graph edge so reindexing is idempotent. */
export function edgeId(
  repositoryId: string,
  edgeType: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourceFile?: string | null,
  sourceLine?: number | null,
): string {
  return prefixedId(
    'edge',
    `${repositoryId}|${edgeType}|${sourceNodeId}|${targetNodeId}|${sourceFile ?? ''}|${sourceLine ?? ''}`,
  );
}
