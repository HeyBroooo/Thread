import type { ChatAnswer, EdgeType, GraphNode, SourceEvidence } from '@cbi/shared';
import { createLogger, isStructuralEdge } from '@cbi/shared';
import type { GraphStore } from '@cbi/graph';
import type { SearchService } from '@cbi/search';
import type { SourceRegistry } from '@cbi/shared';
import { ContextBuilder, type ContextBuildOptions } from './context.js';
import { generateStructured, type AIProvider } from './provider.js';
import { CHAT_SCHEMA_HINT, CHAT_SYSTEM_PROMPT } from './prompts.js';
import { ChatAnswerSchema } from './schemas.js';
import { OpenRouterProvider } from './openrouter.js';

const log = createLogger({ component: 'ai.chat' });

export interface ChatDeps {
  store: GraphStore;
  search: SearchService;
  sources: SourceRegistry;
  provider?: AIProvider;
}

export interface ChatOptions extends ContextBuildOptions {
  /** Set when the repository graph is not fully indexed (doc §12). */
  partialGraph?: boolean;
  partialNote?: string;
  model?: string;
  maxCandidates?: number;
}

export class CodebaseChat {
  private contextBuilder: ContextBuilder;
  private provider: AIProvider | null;

  constructor(private deps: ChatDeps) {
    this.contextBuilder = new ContextBuilder(deps.store, deps.sources);
    this.provider = deps.provider ?? null;
  }

  private getProvider(): AIProvider {
    if (!this.provider) this.provider = new OpenRouterProvider();
    return this.provider;
  }

  async ask(repositoryId: string, question: string, options: ChatOptions = {}): Promise<ChatAnswer> {
    const candidates = await this.deps.search.search(repositoryId, question, {
      limit: options.maxCandidates ?? 8,
    });

    if (candidates.length === 0) {
      return {
        answer: 'I could not find any relevant symbols or files in the indexed graph for this question.',
        references: [],
        relationships: [],
        canvasPath: [],
        confidence: 0,
        partial: options.partialGraph ?? false,
        unverified: true,
      };
    }

    const anchors = candidates.slice(0, 3).map((c) => c.nodeId);
    const pkg = await this.contextBuilder.build(repositoryId, anchors, options);

    const { data } = await generateStructured(
      this.getProvider(),
      {
        system: CHAT_SYSTEM_PROMPT,
        context: pkg.text,
        user: question,
        schema: CHAT_SCHEMA_HINT,
        model: options.model,
        temperature: 0.1,
      },
      { schema: ChatAnswerSchema },
    );

    const validated = await this.validate(repositoryId, data.references, pkg.nodes);
    const relationships = data.relationships
      .map((r) => ({ ...r, relationship: r.relationship.toUpperCase() as EdgeType }))
      .slice(0, 20);

    let confidence = data.confidence;
    let unverified = data.unverified ?? false;

    if (data.references.length > 0 && validated.length === 0) {
      unverified = true;
      confidence = Math.min(confidence, 0.3);
      log.warn('chat.references_rejected', { repositoryId, requested: data.references.length });
    }

    let answer = data.answer;
    if (options.partialGraph) {
      answer += `\n\n> Note: the repository graph is still being built${options.partialNote ? ` (${options.partialNote})` : ''}, so API and architecture analysis may be incomplete.`;
    }
    if (unverified && !/could not|cannot|insufficient|unable/i.test(answer)) {
      answer += '\n\n> This answer could not be fully verified against the indexed graph.';
    }

    return {
      answer,
      references: validated,
      relationships,
      canvasPath: pkg.canvasPath,
      confidence: Number(confidence.toFixed(2)),
      partial: options.partialGraph ?? false,
      unverified,
    };
  }

  /**
   * Hallucination protection (doc §62): every reference must point at a real
   * file and a plausible line range in the indexed graph.
   */
  private async validate(
    repositoryId: string,
    references: Array<{ file: string; startLine: number; endLine: number; symbol?: string | null }>,
    contextNodes: GraphNode[],
  ): Promise<SourceEvidence[]> {
    const nodes = await this.deps.store.getNodesByRepository(repositoryId, { limit: 250_000 });
    const fileMaxLine = new Map<string, number>();
    const symbolIds = new Map<string, string>();
    for (const node of nodes) {
      if (!node.filePath) continue;
      const current = fileMaxLine.get(node.filePath) ?? 0;
      fileMaxLine.set(node.filePath, Math.max(current, node.endLine ?? 0));
      symbolIds.set(`${node.filePath}#${node.name}`, node.id);
    }
    const contextIds = new Set(contextNodes.map((n) => n.id));

    const out: SourceEvidence[] = [];
    const seen = new Set<string>();
    for (const ref of references) {
      const file = ref.file.replace(/\\/g, '/').replace(/^\/+/, '');
      const maxLine = fileMaxLine.get(file);
      if (maxLine === undefined) continue; // hallucinated file
      const startLine = Math.max(1, Math.min(ref.startLine, Math.max(1, maxLine)));
      const endLine = Math.max(startLine, Math.min(ref.endLine, Math.max(startLine, maxLine)));
      const key = `${file}:${startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const nodeId = ref.symbol ? symbolIds.get(`${file}#${ref.symbol}`) ?? null : null;
      const content = this.deps.sources.getFileContent(file);
      const snippet = content
        ? content
            .split(/\r?\n/)
            .slice(startLine - 1, endLine)
            .join('\n')
            .slice(0, 1500)
        : '';
      out.push({
        nodeId: nodeId && contextIds.has(nodeId) ? nodeId : nodeId,
        filePath: file,
        startLine,
        endLine,
        symbol: ref.symbol ?? null,
        snippet,
      });
    }
    return out.slice(0, 12);
  }
}

export function summarizeRelationships(_edges: Array<{ edgeType: EdgeType }>): number {
  return _edges.filter((e) => !isStructuralEdge(e.edgeType)).length;
}
