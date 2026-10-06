import { join } from 'node:path';
import {
  GRAPH_SCHEMA_VERSION,
  PARSER_VERSION,
  analyzeRepository,
  type AnalyzeOptions,
  type AnalyzedRepository,
} from '@cbi/parser';
import { buildGraph, applyBuiltGraph, validateGraph, type GraphStore, type ValidationReport } from '@cbi/graph';
import type { AnalysisResult } from '@cbi/analyzer';
import type { ArchitectureSummary, Convention } from '@cbi/analyzer';
import { createLogger, getConfig, type IndexStage } from '@cbi/shared';
import { analyzeGitHistory, isGitRepository, getHeadSha, type GitAnalysis } from '@cbi/github';
import { getEmbeddingProvider } from '@cbi/search';
import * as db from '@cbi/db';

const log = createLogger({ component: 'indexer' });

export interface ProgressUpdate {
  stage: IndexStage;
  progress: number;
  filesProcessed: number;
  filesTotal: number;
  nodesCreated: number;
  edgesCreated: number;
  error?: string;
}

export interface IndexJobInput {
  repositoryId: string;
  /** Local checkout directory to analyze. */
  root: string;
  commitSha: string;
  store: GraphStore;
  incremental?: boolean;
  changedFiles?: string[];
  analyzeOptions?: AnalyzeOptions;
  persistToDatabase?: boolean;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface IndexJobResult {
  commitSha: string;
  filesParsed: number;
  filesSkipped: number;
  nodes: number;
  edges: number;
  unresolvedImports: number;
  parseErrors: number;
  validation: ValidationReport;
  architecture: ArchitectureSummary;
  conventions: Convention[];
  analysis: AnalysisResult;
  git: GitAnalysis;
  parserVersion: string;
  graphSchemaVersion: number;
  durationMs: number;
  skippedLanguages: string[];
}

const STAGE_PROGRESS: Record<string, number> = {
  QUEUED: 2,
  CLONING: 6,
  DISCOVERING: 12,
  PARSING: 35,
  RESOLVING: 55,
  FRAMEWORK_ANALYSIS: 65,
  API_ANALYSIS: 72,
  GIT_ANALYSIS: 78,
  SEMANTIC_INDEXING: 88,
  VALIDATING: 95,
  READY: 100,
};

/**
 * Full indexing run (doc §9/§10). Correctness first: the graph is built
 * deterministically, validated, then persisted. Every stage reports real
 * progress — never fake progress.
 */
export async function runIndexingJob(input: IndexJobInput): Promise<IndexJobResult> {
  const started = Date.now();
  const persist = input.persistToDatabase ?? Boolean(getConfig().databaseUrl);
  const progress = (stage: IndexStage, extra: Partial<ProgressUpdate> = {}) => {
    input.onProgress?.({
      stage,
      progress: STAGE_PROGRESS[stage] ?? 0,
      filesProcessed: extra.filesProcessed ?? 0,
      filesTotal: extra.filesTotal ?? 0,
      nodesCreated: extra.nodesCreated ?? 0,
      edgesCreated: extra.edgesCreated ?? 0,
      ...(extra.error ? { error: extra.error } : {}),
    });
  };

  progress('DISCOVERING');
  const analyzed: AnalyzedRepository = analyzeRepository(input.root, {
    ...(input.analyzeOptions ?? {}),
    ...(input.incremental && input.changedFiles ? { only: input.changedFiles } : {}),
    onProgress: ({ processed, total }) =>
      input.onProgress?.({
        stage: 'PARSING',
        progress: STAGE_PROGRESS['PARSING']! + Math.round((processed / Math.max(1, total)) * 20),
        filesProcessed: processed,
        filesTotal: total,
        nodesCreated: 0,
        edgesCreated: 0,
      }),
  });

  progress('RESOLVING', {
    filesProcessed: analyzed.stats.filesParsed,
    filesTotal: analyzed.files.length,
  });

  progress('FRAMEWORK_ANALYSIS');
  progress('API_ANALYSIS');
  const built = buildGraph(input.repositoryId, analyzed);

  progress('VALIDATING', { nodesCreated: built.nodes.length, edgesCreated: built.edges.length });
  const validation = validateGraph(
    { repositoryId: input.repositoryId, nodes: built.nodes, edges: built.edges },
    { unresolvedImports: analyzed.stats.unresolvedImports },
  );

  if (validation.status === 'failed') {
    progress('FAILED', { error: `Graph validation failed with ${validation.errors} error(s).` });
    throw new Error(`Graph validation failed with ${validation.errors} error(s) for ${input.repositoryId}.`);
  }

  await applyBuiltGraph(input.store, input.repositoryId, built, {
    replace: !input.incremental,
    ...(input.incremental && input.changedFiles ? { changedFiles: input.changedFiles } : {}),
  });

  progress('GIT_ANALYSIS');
  const git = isGitRepository(input.root)
    ? analyzeGitHistory(input.root, { maxCommits: 200 })
    : { available: false, headSha: null, commits: [], fileHistory: [], changeCoupling: [], frequentlyChanged: [] };

  if (persist && git.available) {
    await persistGitHistory(input.repositoryId, git).catch((e) =>
      log.warn('indexer.git_history_persist_failed', { message: e instanceof Error ? e.message : String(e) }),
    );
  }

  progress('SEMANTIC_INDEXING');
  let embeddingsStored = 0;
  if (persist) {
    try {
      embeddingsStored = await persistSemanticIndex(input.repositoryId, analyzed, built.nodes);
    } catch (e) {
      log.warn('indexer.semantic_persist_failed', { message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Carry the real file counts into the final update — the progress helper
  // defaults omitted fields to 0, which would erase the RESOLVING numbers.
  progress('READY', {
    filesProcessed: analyzed.stats.filesParsed,
    filesTotal: analyzed.files.length,
    nodesCreated: built.nodes.length,
    edgesCreated: built.edges.length,
  });

  const result: IndexJobResult = {
    commitSha: input.commitSha,
    filesParsed: analyzed.stats.filesParsed,
    filesSkipped: analyzed.stats.filesSkipped,
    nodes: built.nodes.length,
    edges: built.edges.length,
    unresolvedImports: analyzed.stats.unresolvedImports,
    parseErrors: analyzed.stats.parseErrors,
    validation,
    architecture: built.analysis.architecture,
    conventions: built.analysis.conventions,
    analysis: built.analysis,
    git,
    parserVersion: PARSER_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    durationMs: Date.now() - started,
    skippedLanguages: built.analysis.unsupported.skippedLanguages,
  };

  log.info('index.completed', {
    repositoryId: input.repositoryId,
    commitSha: input.commitSha,
    durationMs: result.durationMs,
    files: result.filesParsed,
    nodes: result.nodes,
    edges: result.edges,
    warnings: validation.warnings,
  });

  return result;
}

async function persistSemanticIndex(
  repositoryId: string,
  analyzed: AnalyzedRepository,
  nodes: Array<{ id: string; nodeType: string; name: string; filePath: string | null; startLine: number | null; endLine: number | null }>,
): Promise<number> {
  if (!db.hasDatabase()) return 0;
  const provider = getEmbeddingProvider();

  // Embed meaningful units only (doc §85): components/hooks/services/APIs/routes.
  const embeddable = nodes.filter((n) =>
    ['component', 'hook', 'function', 'service', 'class', 'api_endpoint', 'route', 'context', 'store'].includes(n.nodeType),
  );
  const texts = embeddable.map((n) => `${n.name} ${n.nodeType} ${n.filePath ?? ''}`);
  const vectors = await provider.embed(texts);

  const pool = db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM embeddings WHERE repository_id = $1', [repositoryId]);
    for (let i = 0; i < embeddable.length; i++) {
      const node = embeddable[i]!;
      const vector = vectors[i];
      if (!vector) continue;
      await client.query(
        `INSERT INTO embeddings (repository_id, node_id, embedding, model, metadata_json)
         VALUES ($1,$2,$3::vector,$4,$5)`,
        [repositoryId, node.id, `[${vector.join(',')}]`, provider.id, JSON.stringify({ nodeType: node.nodeType, filePath: node.filePath })],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return embeddable.length;
}

async function persistGitHistory(repositoryId: string, git: GitAnalysis): Promise<void> {
  if (!db.hasDatabase()) return;
  const pool = db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM file_history WHERE repository_id = $1', [repositoryId]);
    for (const entry of git.fileHistory.slice(0, 20_000)) {
      await client.query(
        `INSERT INTO file_history (repository_id, file_path, commit_sha, author, committed_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [repositoryId, entry.filePath, entry.lastCommitSha ?? '', entry.authors[0] ?? null, entry.lastCommittedAt ? new Date(entry.lastCommittedAt) : null],
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

export function currentBranchSha(root: string): string | null {
  return getHeadSha(root);
}

export function defaultCheckoutPath(owner: string, repo: string): string {
  return join(process.cwd(), '.cbi', 'checkouts', `${owner}__${repo}`);
}
