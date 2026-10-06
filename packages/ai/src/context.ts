import type { GraphEdge, GraphNode, SourceEvidence } from '@cbi/shared';
import { estimateTokens, redactSecrets, sliceLines, truncateMiddle } from '@cbi/shared';
import type { GraphStore } from '@cbi/graph';
import type { SourceRegistry } from '@cbi/shared';

/** Structural edges are cheap context; behavioural edges explain the flow. */
const EDGE_PRIORITY: Record<string, number> = {
  CALLS: 100,
  RENDERS: 95,
  CALLS_API: 90,
  USES: 80,
  USES_CONTEXT: 78,
  USES_STORE: 78,
  IMPLEMENTS: 70,
  EXTENDS: 70,
  NAVIGATES_TO: 65,
  TESTS: 60,
  REFERENCES: 50,
  EXPORTS: 40,
  IMPORTS: 35,
  DEFINED_IN: 20,
  CONTAINS: 10,
  DEPENDS_ON: 30,
  READS: 45,
  WRITES: 45,
  CHANGED_WITH: 5,
  MODIFIED_BY: 5,
};

export interface ContextPackage {
  text: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  references: SourceEvidence[];
  canvasPath: string[];
  truncated: boolean;
  tokens: number;
  redactions: number;
}

export interface ContextBuildOptions {
  depth?: number;
  maxNodes?: number;
  edgeTypes?: string[];
  maxTokens?: number;
  snippetLines?: number;
  direction?: 'out' | 'in' | 'both';
  /** Include IMPORTS/CONTAINS noise. Default false. */
  includeStructural?: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<ContextBuildOptions, 'edgeTypes'>> = {
  depth: 2,
  maxNodes: 60,
  maxTokens: 6000,
  snippetLines: 24,
  direction: 'both',
  includeStructural: false,
};

export class ContextBuilder {
  constructor(
    private store: GraphStore,
    private sources: SourceRegistry,
  ) {}

  async build(
    repositoryId: string,
    anchorIds: string[],
    options: ContextBuildOptions = {},
  ): Promise<ContextPackage> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const order: string[] = [];
    let truncated = false;

    for (const anchorId of anchorIds) {
      const sub = await this.store.neighborhood(anchorId, {
        depth: opts.depth,
        maxNodes: opts.maxNodes,
        direction: opts.direction,
        ...(opts.edgeTypes ? { edgeTypes: opts.edgeTypes as never } : {}),
      });
      truncated ||= sub.truncated;
      for (const node of sub.nodes) {
        if (!nodes.has(node.id)) {
          nodes.set(node.id, node);
          order.push(node.id);
        }
      }
      for (const edge of sub.edges) edges.set(edge.id, edge);
    }

    const filteredEdges = [...edges.values()].filter((e) =>
      opts.includeStructural ? true : !['CONTAINS', 'DEFINED_IN', 'EXPORTS'].includes(e.edgeType),
    );
    filteredEdges.sort((a, b) => {
      const pa = (EDGE_PRIORITY[a.edgeType] ?? 0) * a.confidence;
      const pb = (EDGE_PRIORITY[b.edgeType] ?? 0) * b.confidence;
      return pb - pa;
    });

    const references = new Map<string, SourceEvidence>();
    let totalRedactions = 0;
    const chunks: string[] = [`REPOSITORY GRAPH EVIDENCE (repository ${repositoryId})`];
    let tokens = estimateTokens(chunks[0]!);

    const nodeLine = (node: GraphNode): string => {
      const loc = node.filePath ? `${node.filePath}${node.startLine ? `:${node.startLine}-${node.endLine ?? node.startLine}` : ''}` : '(no file)';
      return `NODE: ${node.name} | TYPE: ${node.nodeType} | FILE: ${loc}`;
    };

    const usedNodes = new Set<string>();
    let nodeSnippets = 0;
    const maxNodeSnippets = 10;

    const addNodeBlock = (node: GraphNode): string | null => {
      let block = nodeLine(node);
      if (node.filePath && node.startLine && nodeSnippets < maxNodeSnippets) {
        const content = this.sources.getFileContent(node.filePath);
        if (content) {
          const raw = sliceLines(content, node.startLine, Math.min(node.endLine ?? node.startLine + opts.snippetLines, node.startLine + opts.snippetLines));
          const { text, redactions } = redactSecrets(raw);
          totalRedactions += redactions;
          nodeSnippets++;
          block += `\nEVIDENCE (${node.filePath}:${node.startLine}-${Math.min(node.endLine ?? node.startLine, node.startLine + opts.snippetLines)}):\n${text}`;
          references.set(`${node.filePath}:${node.startLine}`, {
            nodeId: node.id,
            filePath: node.filePath,
            startLine: node.startLine,
            endLine: Math.min(node.endLine ?? node.startLine, node.startLine + opts.snippetLines),
            symbol: node.name,
            snippet: text.slice(0, 1500),
          });
        }
      }
      return block;
    };

    for (const edge of filteredEdges) {
      const source = nodes.get(edge.sourceNodeId);
      const target = nodes.get(edge.targetNodeId);
      if (!source || !target) continue;

      const sourceBlock = usedNodes.has(source.id) ? `NODE: ${source.name}` : addNodeBlock(source);
      const targetBlock = addNodeBlock(target);
      const block = [
        sourceBlock,
        `EDGE: ${source.name} --${edge.edgeType}--> ${target.name}  (confidence ${edge.confidence.toFixed(2)})`,
        `SOURCE: ${edge.sourceFile ?? '?'}${edge.sourceLine ? `:${edge.sourceLine}` : ''}  ${redactSecrets(edge.evidence).text}`,
        targetBlock,
      ]
        .filter(Boolean)
        .join('\n');

      const blockTokens = estimateTokens(block);
      if (tokens + blockTokens > opts.maxTokens) {
        truncated = true;
        break;
      }
      usedNodes.add(source.id);
      usedNodes.add(target.id);
      chunks.push(block);
      tokens += blockTokens;
    }

    // Ensure isolated anchors still appear.
    for (const anchorId of anchorIds) {
      const node = nodes.get(anchorId);
      if (!node || usedNodes.has(node.id)) continue;
      const block = addNodeBlock(node);
      if (!block) continue;
      const blockTokens = estimateTokens(block);
      if (tokens + blockTokens > opts.maxTokens) {
        truncated = true;
        break;
      }
      chunks.push(block);
      usedNodes.add(node.id);
      tokens += blockTokens;
    }

    const text = truncateMiddle(chunks.join('\n\n'), opts.maxTokens * 4);
    return {
      text,
      nodes: order.map((id) => nodes.get(id)!).filter(Boolean),
      edges: filteredEdges,
      references: [...references.values()],
      canvasPath: order,
      truncated,
      tokens,
      redactions: totalRedactions,
    };
  }
}
