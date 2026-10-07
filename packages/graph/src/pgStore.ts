import { getPool } from '@cbi/db';
import type { EdgeType, ExtractionMethod, GraphEdge, GraphNode, NodeType } from '@cbi/shared';
import {
  DEFAULT_TRAVERSAL_LIMITS,
  type GraphCounts,
  type GraphStore,
  type NodeFilter,
  type PathResult,
  type Subgraph,
  type TraversalLimits,
} from './model.js';

interface NodeRow {
  id: string;
  repository_id: string;
  node_type: string;
  name: string;
  qualified_name: string;
  file_path: string | null;
  language: string | null;
  start_line: number | null;
  end_line: number | null;
  content_hash: string | null;
  metadata_json: Record<string, unknown>;
}

interface EdgeRow {
  id: string;
  repository_id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: string;
  source_file: string | null;
  source_line: number | null;
  source_column: number | null;
  evidence: string;
  extraction_method: string;
  confidence: number;
  metadata_json: Record<string, unknown>;
}

function rowToNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    nodeType: row.node_type as NodeType,
    name: row.name,
    qualifiedName: row.qualified_name,
    filePath: row.file_path,
    language: row.language,
    startLine: row.start_line,
    endLine: row.end_line,
    contentHash: row.content_hash,
    metadata: row.metadata_json ?? {},
  };
}

function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    edgeType: row.edge_type as EdgeType,
    sourceFile: row.source_file,
    sourceLine: row.source_line,
    sourceColumn: row.source_column,
    evidence: row.evidence,
    extractionMethod: row.extraction_method as ExtractionMethod,
    confidence: row.confidence,
    metadata: row.metadata_json ?? {},
  };
}

export class PgGraphStore implements GraphStore {
  readonly kind = 'postgres' as const;

  private pool = getPool();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async upsertNodes(nodes: GraphNode[]): Promise<void> {
    if (nodes.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const CHUNK = 500;
      for (let i = 0; i < nodes.length; i += CHUNK) {
        const chunk = nodes.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const tuples = chunk.map((n, idx) => {
          const b = idx * 11;
          values.push(
            n.id,
            n.repositoryId,
            n.nodeType,
            n.name,
            n.qualifiedName,
            n.filePath,
            n.language,
            n.startLine,
            n.endLine,
            n.contentHash,
            JSON.stringify(n.metadata ?? {}),
          );
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`;
        });
        await client.query(
          `INSERT INTO graph_nodes
             (id, repository_id, node_type, name, qualified_name, file_path, language, start_line, end_line, content_hash, metadata_json)
           VALUES ${tuples.join(',')}
           ON CONFLICT (id) DO UPDATE SET
             node_type = EXCLUDED.node_type,
             name = EXCLUDED.name,
             qualified_name = EXCLUDED.qualified_name,
             file_path = EXCLUDED.file_path,
             language = EXCLUDED.language,
             start_line = EXCLUDED.start_line,
             end_line = EXCLUDED.end_line,
             content_hash = EXCLUDED.content_hash,
             metadata_json = EXCLUDED.metadata_json,
             updated_at = now()`,
          values,
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async upsertEdges(edges: GraphEdge[]): Promise<void> {
    if (edges.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const CHUNK = 500;
      for (let i = 0; i < edges.length; i += CHUNK) {
        const chunk = edges.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const tuples = chunk.map((e, idx) => {
          const b = idx * 12;
          values.push(
            e.id,
            e.repositoryId,
            e.sourceNodeId,
            e.targetNodeId,
            e.edgeType,
            e.sourceFile,
            e.sourceLine,
            e.sourceColumn,
            e.evidence,
            e.extractionMethod,
            e.confidence,
            JSON.stringify(e.metadata ?? {}),
          );
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`;
        });
        await client.query(
          `INSERT INTO graph_edges
             (id, repository_id, source_node_id, target_node_id, edge_type, source_file, source_line, source_column, evidence, extraction_method, confidence, metadata_json)
           VALUES ${tuples.join(',')}
           ON CONFLICT (id) DO UPDATE SET
             evidence = EXCLUDED.evidence,
             confidence = EXCLUDED.confidence,
             metadata_json = EXCLUDED.metadata_json,
             source_line = EXCLUDED.source_line,
             source_column = EXCLUDED.source_column`,
          values,
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteNodes(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query('DELETE FROM graph_nodes WHERE id = ANY($1::text[])', [ids]);
  }

  async deleteEdges(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query('DELETE FROM graph_edges WHERE id = ANY($1::text[])', [ids]);
  }

  async clearRepository(repositoryId: string): Promise<void> {
    await this.pool.query('DELETE FROM graph_edges WHERE repository_id = $1', [repositoryId]);
    await this.pool.query('DELETE FROM graph_nodes WHERE repository_id = $1', [repositoryId]);
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const res = await this.pool.query<NodeRow>('SELECT * FROM graph_nodes WHERE id = $1', [id]);
    return res.rows[0] ? rowToNode(res.rows[0]) : null;
  }

  async getNodes(ids: string[]): Promise<GraphNode[]> {
    if (ids.length === 0) return [];
    const res = await this.pool.query<NodeRow>('SELECT * FROM graph_nodes WHERE id = ANY($1::text[])', [ids]);
    return res.rows.map(rowToNode);
  }

  async getNodesByRepository(repositoryId: string, filter?: NodeFilter): Promise<GraphNode[]> {
    const params: unknown[] = [repositoryId];
    const clauses = ['repository_id = $1'];
    if (filter?.nodeTypes?.length) {
      params.push(filter.nodeTypes);
      clauses.push(`node_type = ANY($${params.length}::text[])`);
    }
    if (filter?.filePrefix) {
      params.push(`${filter.filePrefix}%`);
      clauses.push(`file_path LIKE $${params.length}`);
    }
    if (filter?.nameQuery) {
      params.push(`%${filter.nameQuery.toLowerCase()}%`);
      clauses.push(`(lower(name) LIKE $${params.length} OR lower(qualified_name) LIKE $${params.length})`);
    }
    let sql = `SELECT * FROM graph_nodes WHERE ${clauses.join(' AND ')} ORDER BY id`;
    if (filter?.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const res = await this.pool.query<NodeRow>(sql, params);
    return res.rows.map(rowToNode);
  }

  async getEdgesByRepository(repositoryId: string, filter?: NodeFilter): Promise<GraphEdge[]> {
    const params: unknown[] = [repositoryId];
    const clauses = ['repository_id = $1'];
    if (filter?.edgeTypes?.length) {
      params.push(filter.edgeTypes);
      clauses.push(`edge_type = ANY($${params.length}::text[])`);
    }
    let sql = `SELECT * FROM graph_edges WHERE ${clauses.join(' AND ')}`;
    if (filter?.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const res = await this.pool.query<EdgeRow>(sql, params);
    return res.rows.map(rowToEdge);
  }

  async getEdgesFrom(nodeId: string): Promise<GraphEdge[]> {
    const res = await this.pool.query<EdgeRow>('SELECT * FROM graph_edges WHERE source_node_id = $1', [nodeId]);
    return res.rows.map(rowToEdge);
  }

  async getEdgesTo(nodeId: string): Promise<GraphEdge[]> {
    const res = await this.pool.query<EdgeRow>('SELECT * FROM graph_edges WHERE target_node_id = $1', [nodeId]);
    return res.rows.map(rowToEdge);
  }

  async count(repositoryId: string): Promise<GraphCounts> {
    const [n, e] = await Promise.all([
      this.pool.query<{ c: string }>('SELECT count(*)::text AS c FROM graph_nodes WHERE repository_id = $1', [repositoryId]),
      this.pool.query<{ c: string }>('SELECT count(*)::text AS c FROM graph_edges WHERE repository_id = $1', [repositoryId]),
    ]);
    return { nodes: Number(n.rows[0]?.c ?? 0), edges: Number(e.rows[0]?.c ?? 0) };
  }

  async neighborhood(nodeId: string, limits: Partial<TraversalLimits> = {}): Promise<Subgraph> {
    const merged: TraversalLimits = { ...DEFAULT_TRAVERSAL_LIMITS, ...limits };
    const edgeTypes = merged.edgeTypes ? new Set(merged.edgeTypes) : null;
    const direction = merged.direction ?? 'out';
    const visited = new Set<string>([nodeId]);
    const edges = new Map<string, GraphEdge>();
    let frontier = [nodeId];
    let depth = 0;
    let truncated = false;

    while (frontier.length > 0 && depth < merged.depth) {
      const next: string[] = [];
      for (const id of frontier) {
        const collected: GraphEdge[] = [];
        if (direction !== 'in') collected.push(...(await this.getEdgesFrom(id)));
        if (direction !== 'out') collected.push(...(await this.getEdgesTo(id)));
        for (const edge of collected) {
          if (edgeTypes && !edgeTypes.has(edge.edgeType)) continue;
          const other = edge.sourceNodeId === id ? edge.targetNodeId : edge.sourceNodeId;
          edges.set(edge.id, edge);
          if (visited.has(other)) continue;
          if (visited.size >= merged.maxNodes) {
            truncated = true;
            continue;
          }
          visited.add(other);
          next.push(other);
        }
      }
      frontier = next;
      depth++;
    }

    const nodes = await this.getNodes([...visited]);
    return { nodes, edges: [...edges.values()], truncated };
  }

  async findPath(fromId: string, toId: string, maxDepth = 6): Promise<PathResult> {
    if (fromId === toId) {
      const n = await this.getNode(fromId);
      return { found: Boolean(n), nodes: n ? [n] : [], edges: [], length: 0 };
    }
    const prev = new Map<string, { nodeId: string; edge: GraphEdge }>();
    const visited = new Set<string>([fromId]);
    let frontier = [fromId];
    let depth = 0;
    let found = false;
    while (frontier.length && depth < maxDepth && !found) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of await this.getEdgesFrom(id)) {
          if (visited.has(e.targetNodeId)) continue;
          visited.add(e.targetNodeId);
          prev.set(e.targetNodeId, { nodeId: id, edge: e });
          if (e.targetNodeId === toId) {
            found = true;
            break;
          }
          next.push(e.targetNodeId);
        }
        if (found) break;
      }
      frontier = next;
      depth++;
    }
    if (!found) return { found: false, nodes: [], edges: [], length: 0 };

    const pathEdges: GraphEdge[] = [];
    const pathNodes: GraphNode[] = [];
    let cursor = toId;
    while (cursor !== fromId) {
      const step = prev.get(cursor);
      if (!step) break;
      pathEdges.unshift(step.edge);
      const n = await this.getNode(cursor);
      if (n) pathNodes.unshift(n);
      cursor = step.nodeId;
    }
    const start = await this.getNode(fromId);
    if (start) pathNodes.unshift(start);
    return { found: true, nodes: pathNodes, edges: pathEdges, length: pathEdges.length };
  }

  async reachable(anchorIds: string[], limits: Partial<TraversalLimits> = {}): Promise<Map<string, number>> {
    const merged: TraversalLimits = { ...DEFAULT_TRAVERSAL_LIMITS, depth: 4, maxNodes: 500, ...limits };
    const distances = new Map<string, number>();
    for (const a of anchorIds) distances.set(a, 0);
    let frontier = [...anchorIds];
    let depth = 0;
    while (frontier.length && depth < merged.depth && distances.size < merged.maxNodes) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of await this.getEdgesFrom(id)) {
          if (merged.edgeTypes && !merged.edgeTypes.includes(e.edgeType)) continue;
          if (distances.has(e.targetNodeId)) continue;
          distances.set(e.targetNodeId, depth + 1);
          next.push(e.targetNodeId);
          if (distances.size >= merged.maxNodes) break;
        }
      }
      frontier = next;
      depth++;
    }
    return distances;
  }
}
