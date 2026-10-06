import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { existsSync } from 'node:fs';
import { AppError, Errors, createLogger, getConfig, isAppError, uuid, type EdgeType, type GraphEdge, type GraphNode, type NodeType } from '@cbi/shared';
import {
  cloneOrPull,
  normalizeWebhook,
  parseRepoReference,
  shouldTriggerReview,
  verifyWebhookSignature,
  type GitHubPullRequestSummary,
} from '@cbi/github';
import type { Convention, RuleConfig } from '@cbi/analyzer';
import { runIndexingJob } from '@cbi/indexer';
import { runReviewJob, REVIEW_VERSION } from '@cbi/pr-reviewer';
import * as db from '@cbi/db';
import {
  aiProvider,
  chatService,
  createRepo,
  createSearchService,
  ensureBootstrapIfNeeded,
  getRepo,
  graphStore,
  listRepos,
  sourceRegistry,
  updateRepo,
  usingDatabase,
  type RepoRecord,
} from './services.js';
import { jobQueue, type JobRecord } from './queue.js';
import { githubClientFor, resolveCloneCredential, resolveGitHubAccess } from './github.js';
import { readProjectManifest } from './manifests.js';
import { clearToken, saveToken, tokenStatus } from './credentials.js';
import {
  claimForScheduling,
  listMemoryFindings,
  listMemoryPullRequests,
  listMemoryReviews,
  newReviewId,
  recordPullRequest,
  recordReview,
  releaseScheduled,
  toFindingRecord,
  type ReviewFindingRecord,
} from './prStore.js';

const log = createLogger({ component: 'api' });

export interface AppContext {
  Variables: {
    requestId: string;
  };
}

export function createApp(): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? `req_${uuid().slice(0, 10)}`;
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    const started = Date.now();
    await next();
    log.info('http.request', {
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Date.now() - started,
    });
  });

  app.use('/api/*', cors({ origin: (origin) => origin ?? '*', allowHeaders: ['content-type', 'x-request-id'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    if (isAppError(err)) {
      if (err.httpStatus >= 500) log.error('api.error', { requestId, code: err.code, message: err.message });
      return c.json(err.toBody(requestId), err.httpStatus as 400);
    }
    log.error('api.unhandled', { requestId, message: err instanceof Error ? err.message : String(err) });
    return c.json(Errors.internal().toBody(requestId), 500);
  });

  app.notFound((c) => c.json(Errors.badRequest(`No route for ${c.req.method} ${new URL(c.req.url).pathname}`, undefined).toBody(c.get('requestId') ?? 'unknown'), 404));

  app.get('/health', (c) =>
    c.json({
      ok: true,
      database: usingDatabase(),
      ai: Boolean(getConfig().ai.apiKey),
      github: Boolean(getConfig().github.appId),
      queue: jobQueue.list().filter((j) => j.status === 'RUNNING').length,
    }),
  );

  registerRepositoryRoutes(app);
  registerGraphRoutes(app);
  registerSearchRoutes(app);
  registerChatRoutes(app);
  registerPrRoutes(app);
  registerWebhookRoutes(app);

  // ------------------------------------------------------------------ job handlers
  registerJobHandlers();

  return app;
}

function orgIdOf(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('x-organization-id') ?? 'local-org';
}

async function requireRepo(id: string, organizationId: string): Promise<RepoRecord> {
  const repo = await getRepo(id, organizationId);
  if (!repo) throw Errors.repositoryNotFound(id);
  return repo;
}

/** True when a string is a repository URL rather than a filesystem path. */
function looksLikeUrl(value: string | undefined): boolean {
  if (!value) return false;
  return /^(https?:\/\/|git@|ssh:\/\/|github\.com)/i.test(value.trim());
}

// -------------------------------------------------------------------- repositories

function registerRepositoryRoutes(app: Hono<AppContext>): void {
  app.post('/api/repositories', async (c) => {
    await ensureBootstrapIfNeeded();
    const body = (await c.req.json().catch(() => ({}))) as {
      owner?: string;
      name?: string;
      branch?: string;
      defaultBranch?: string;
      checkoutPath?: string;
      repoUrl?: string;
      /** Set false to register the repo without cloning or indexing. */
      autoIndex?: boolean;
    };

    // Accept either explicit owner/name or a pasted URL / owner#name reference.
    let owner = body.owner?.trim() ?? '';
    let name = body.name?.trim() ?? '';
    let branch = body.branch?.trim() || undefined;
    let repoUrl = body.repoUrl?.trim() ?? '';

    // A URL pasted into the checkout field used to be stored as the checkout
    // path, which silently produced a graph containing only the repository
    // node. Treat it as the repo URL instead.
    if (!repoUrl && looksLikeUrl(body.checkoutPath)) repoUrl = body.checkoutPath!.trim();
    const checkoutPathInput = looksLikeUrl(body.checkoutPath) ? undefined : body.checkoutPath;

    if (!owner || !name) {
      const parsed = parseRepoReference(repoUrl);
      if (!parsed) {
        throw Errors.badRequest(
          'Provide a repository URL (e.g. https://github.com/owner/name) or `owner` and `name`.',
        );
      }
      owner = owner || parsed.owner;
      name = name || parsed.name;
      branch = branch ?? parsed.branch ?? undefined;
    }

    const wantsClone = !checkoutPathInput || Boolean(repoUrl);
    let checkoutPath = checkoutPathInput;
    let cloned = null;

    if (wantsClone) {
      // App installation when it covers the repo, otherwise the saved token —
      // that is what makes private repositories cloneable without an App.
      const cred = await resolveCloneCredential({ owner, name });
      if (!cred.token) log.warn('clone.no_credential', { owner, name, note: 'public repos clone anonymously; private ones need an App installation or a token' });
      cloned = await cloneOrPull({ owner, name, branch, token: cred.token, existingPath: checkoutPathInput ?? null });
      checkoutPath = cloned.checkoutPath;
      branch = branch ?? cloned.branch;
    }

    const repo = await createRepo({
      owner,
      name,
      branch,
      defaultBranch: body.defaultBranch ?? branch,
      checkoutPath,
      organizationId: orgIdOf(c),
    });
    if (usingDatabase()) {
      await db.writeAuditLog({
        organizationId: repo.organizationId,
        repositoryId: repo.id,
        action: 'repository.connected',
        metadata: { owner: repo.owner, name: repo.name },
        requestId: c.get('requestId'),
      });
    }

    // Cloning is only half the job — walk the files and build the graph so the
    // canvas has something to draw as soon as the user lands on the repo.
    let job: JobRecord | null = null;
    if (body.autoIndex !== false && checkoutPath) {
      job = jobQueue.enqueue(
        'index',
        repo.id,
        {
          checkoutPath,
          commitSha: cloned?.commitSha ?? null,
          incremental: false,
          changedFiles: [],
        },
        c.get('requestId'),
      );
    }

    return c.json(
      { repository: serializeRepo(repo), latestJob: job ? serializeJob(job) : null, cloned: Boolean(cloned) },
      201,
    );
  });

  /**
   * Reports whether the GitHub App can reach a repository, so the UI can ask
   * for access up front instead of failing at clone time with a git error.
   */
  app.post('/api/github/access', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { repoUrl?: string; owner?: string; name?: string };
    const parsed = parseRepoReference(body.repoUrl ?? '') ??
      (body.owner && body.name ? { owner: body.owner, name: body.name, branch: null } : null);
    if (!parsed) throw Errors.badRequest('Provide a repository URL or `owner` and `name`.');

    const config = getConfig();
    const appConfigured = Boolean(config.github.appId && config.github.privateKey);

    if (!appConfigured) {
      return c.json({
        owner: parsed.owner,
        name: parsed.name,
        appConfigured: false,
        accessible: null,
        requiresInstall: false,
        message:
          'No GitHub App credentials are configured. Public repositories can still be cloned anonymously; set GITHUB_APP_ID and GITHUB_PRIVATE_KEY to read private ones.',
      });
    }

    // Always 200: resolution never throws — it reports the best credential it
    // could find plus exactly what is blocking comments.
    const access = await resolveGitHubAccess(parsed.owner, parsed.name);
    const cap = access.capability;
    return c.json({
      owner: parsed.owner,
      name: parsed.name,
      appConfigured: cap.appConfigured,
      accessible: cap.repoAccessible,
      requiresInstall: !cap.canComment,
      canComment: cap.canComment,
      mode: cap.mode,
      installationId: cap.installationId,
      missingPermissions: cap.missingPermissions,
      permissionUpdatePending: cap.permissionUpdatePending,
      accessibleRepoCount: cap.accessibleRepoCount,
      rateLimited: cap.rateLimited,
      tokenSource: cap.tokenSource,
      links: {
        installUrl: cap.installUrl,
        appSettingsUrl: cap.appSettingsUrl,
        appPermissionsUrl: cap.appPermissionsUrl,
        installationUrl: cap.installationUrl,
      },
      message: cap.message,
    });
  });

  /** Which GitHub credential the server is using (never returns the secret). */
  app.get('/api/github/credentials', (c) => c.json(tokenStatus()));

  /**
   * Save a personal access token so reviews can be posted immediately, for
   * public *and* private repositories, without waiting on App settings.
   */
  app.post('/api/github/credentials', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      clearToken();
      return c.json({ ok: true, ...tokenStatus() });
    }
    try {
      const { login, scopes } = await saveToken(token);
      return c.json({ ...tokenStatus(), ok: true, login, scopes });
    } catch (e) {
      throw Errors.badRequest(e instanceof Error ? e.message : 'Could not validate that token.');
    }
  });

  app.get('/api/repositories', async (c) => {
    await ensureBootstrapIfNeeded();
    const repos = await listRepos(orgIdOf(c));
    const latest = new Map<string, JobRecord | null>();
    for (const repo of repos) latest.set(repo.id, jobQueue.latest(repo.id, 'index'));
    return c.json({
      repositories: repos.map((repo) => ({
        ...serializeRepo(repo),
        latestJob: latest.get(repo.id) ? serializeJob(latest.get(repo.id)!) : null,
      })),
    });
  });

  app.get('/api/repositories/:id', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const job = jobQueue.latest(repo.id, 'index');
    return c.json({ repository: serializeRepo(repo), latestJob: job ? serializeJob(job) : null });
  });

  app.post('/api/repositories/:id/index', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const body = (await c.req.json().catch(() => ({}))) as {
      checkoutPath?: string;
      commitSha?: string;
      incremental?: boolean;
      changedFiles?: string[];
    };
    const job = jobQueue.enqueue(
      'index',
      repo.id,
      {
        checkoutPath: body.checkoutPath ?? repo.checkoutPath,
        commitSha: body.commitSha ?? null,
        incremental: body.incremental ?? false,
        changedFiles: body.changedFiles ?? [],
      },
      c.get('requestId'),
    );
    await updateRepo(repo.id, { indexStatus: 'QUEUED', error: null });
    if (usingDatabase()) {
      await db.writeAuditLog({
        organizationId: repo.organizationId,
        repositoryId: repo.id,
        action: 'index.started',
        metadata: { jobId: job.id, incremental: body.incremental ?? false },
        requestId: c.get('requestId'),
      });
    }
    return c.json({ job: serializeJob(job) }, 202);
  });

  app.get('/api/repositories/:id/index', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const jobId = c.req.query('jobId');
    const job = jobId ? jobQueue.get(jobId) : jobQueue.latest(repo.id, 'index');
    return c.json({ repository: serializeRepo(repo), job: job ? serializeJob(job) : null });
  });
}

// -------------------------------------------------------------------- graph

function serializeRepo(repo: RepoRecord) {
  return {
    id: repo.id,
    organizationId: repo.organizationId,
    owner: repo.owner,
    name: repo.name,
    branch: repo.branch,
    defaultBranch: repo.defaultBranch,
    indexedCommitSha: repo.indexedCommitSha,
    indexStatus: repo.indexStatus,
    parserVersion: repo.parserVersion,
    graphSchemaVersion: repo.graphSchemaVersion,
    lastIndexedAt: repo.lastIndexedAt,
    error: repo.error,
    checkoutPath: repo.checkoutPath,
  };
}

function serializeJob(job: JobRecord) {
  return {
    id: job.id,
    kind: job.kind,
    repositoryId: job.repositoryId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    filesProcessed: job.filesProcessed,
    filesTotal: job.filesTotal,
    nodesCreated: job.nodesCreated,
    edgesCreated: job.edgesCreated,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
  };
}

function toClientNode(node: GraphNode) {
  return {
    id: node.id,
    nodeType: node.nodeType,
    name: node.name,
    qualifiedName: node.qualifiedName,
    filePath: node.filePath,
    language: node.language,
    startLine: node.startLine,
    endLine: node.endLine,
    metadata: node.metadata,
  };
}

function toClientEdge(edge: GraphEdge) {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    edgeType: edge.edgeType,
    confidence: edge.confidence,
    evidence: edge.evidence,
    sourceFile: edge.sourceFile,
    sourceLine: edge.sourceLine,
    extractionMethod: edge.extractionMethod,
  };
}

function registerGraphRoutes(app: Hono<AppContext>): void {
  app.get('/api/repositories/:id/graph', async (c) => {
    await requireRepo(c.req.param('id'), orgIdOf(c));
    const store = graphStore();
    const scope = c.req.query('scope') ?? 'full';
    const limit = Math.min(Number(c.req.query('limit') ?? 1500), 5000);
    const nodeTypes = c.req.query('nodeTypes')?.split(',').filter(Boolean) as NodeType[] | undefined;
    const edgeTypes = c.req.query('edgeTypes')?.split(',').filter(Boolean) as EdgeType[] | undefined;
    const filePrefix = c.req.query('filePrefix');

    const repositoryId = c.req.param('id');
    let nodes = await store.getNodesByRepository(repositoryId, {
      ...(nodeTypes ? { nodeTypes } : {}),
      ...(filePrefix ? { filePrefix } : {}),
      limit: 60_000,
    });

    if (scope === 'overview') {
      const keep: NodeType[] = ['repository', 'folder', 'package', 'configuration', 'file', 'route', 'api_endpoint', 'service'];
      const filtered = nodes.filter((n) => keep.includes(n.nodeType));
      // Prefer top-level files to keep the overview legible.
      const topLevel = filtered.filter((n) => (n.filePath?.split('/').length ?? 99) <= 3);
      nodes = (topLevel.length > 10 ? topLevel : filtered).slice(0, limit);
    } else {
      nodes = nodes.slice(0, limit);
    }

    const ids = new Set(nodes.map((n) => n.id));
    const edges = (await store.getEdgesByRepository(repositoryId, { ...(edgeTypes ? { edgeTypes } : {}), limit: 200_000 })).filter(
      (e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId),
    );

    const counts = await store.count(repositoryId);
    return c.json({
      scope,
      nodes: nodes.map(toClientNode),
      edges: edges.map(toClientEdge),
      truncated: nodes.length >= limit,
      counts,
    });
  });

  app.get('/api/repositories/:id/nodes/:nodeId', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const store = graphStore();
    const node = await store.getNode(c.req.param('nodeId'));
    if (!node || node.repositoryId !== repo.id) throw new AppError('NODE_NOT_FOUND', 'Node was not found in this repository.', 404);
    const [out, incoming] = await Promise.all([store.getEdgesFrom(node.id), store.getEdgesTo(node.id)]);
    const neighborIds = [...out.map((e) => e.targetNodeId), ...incoming.map((e) => e.sourceNodeId)];
    const neighbors = await store.getNodes([...new Set(neighborIds)]);

    const sources = sourceRegistry(repo.checkoutPath);
    let evidence = null;
    if (node.filePath && node.startLine) {
      const content = sources.getFileContent(node.filePath);
      if (content) {
        const lines = content.split(/\r?\n/);
        const start = Math.max(1, node.startLine - 2);
        const end = Math.min(lines.length, (node.endLine ?? node.startLine) + 2);
        evidence = { filePath: node.filePath, startLine: start, endLine: end, snippet: lines.slice(start - 1, end).join('\n') };
      }
    }

    return c.json({
      node: toClientNode(node),
      outgoing: out.map(toClientEdge),
      incoming: incoming.map(toClientEdge),
      neighbors: neighbors.map(toClientNode),
      evidence,
    });
  });

  app.get('/api/repositories/:id/nodes/:nodeId/neighborhood', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const store = graphStore();
    const node = await store.getNode(c.req.param('nodeId'));
    if (!node || node.repositoryId !== repo.id) throw new AppError('NODE_NOT_FOUND', 'Node was not found in this repository.', 404);

    const depth = Math.min(Number(c.req.query('depth') ?? 2), 4);
    const maxNodes = Math.min(Number(c.req.query('maxNodes') ?? 120), 400);
    const edgeTypes = c.req.query('edgeTypes')?.split(',').filter(Boolean) as EdgeType[] | undefined;
    const direction = (c.req.query('direction') as 'out' | 'in' | 'both' | undefined) ?? 'both';

    const sub = await store.neighborhood(node.id, {
      depth,
      maxNodes,
      direction,
      ...(edgeTypes ? { edgeTypes } : {}),
    });
    return c.json({ nodes: sub.nodes.map(toClientNode), edges: sub.edges.map(toClientEdge), truncated: sub.truncated });
  });

  app.get('/api/repositories/:id/paths', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (!from || !to) throw Errors.badRequest('`from` and `to` query parameters are required.');
    const store = graphStore();
    const path = await store.findPath(from, to, Math.min(Number(c.req.query('maxDepth') ?? 8), 12));
    if (!path.found) return c.json({ found: false, nodes: [], edges: [], length: 0 });
    return c.json({
      found: true,
      nodes: path.nodes.map(toClientNode),
      edges: path.edges.map(toClientEdge),
      length: path.length,
      repositoryId: repo.id,
    });
  });

  app.get('/api/repositories/:id/architecture', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const store = graphStore();
    const counts = await store.count(repo.id);
    const nodes = await store.getNodesByRepository(repo.id, { nodeTypes: ['api_endpoint', 'route', 'service', 'package', 'configuration'], limit: 5000 });
    const routes = nodes.filter((n) => n.nodeType === 'route').map((n) => ({ path: n.name, ...n.metadata }));
    const endpoints = nodes
      .filter((n) => n.nodeType === 'api_endpoint')
      .map((n) => ({ label: n.name, ...n.metadata }));
    // `packages` answers "what workspace units exist in the graph". The
    // manifest answers a different question — "what did the user actually
    // install" — so both are returned and the dashboard shows the latter.
    const projectManifest = readProjectManifest(repo.checkoutPath);
    return c.json({
      repository: serializeRepo(repo),
      counts,
      routes,
      endpoints,
      services: nodes.filter((n) => n.nodeType === 'service').map((n) => ({ name: n.name, filePath: n.filePath })),
      packages: nodes.filter((n) => n.nodeType === 'package').map((n) => n.name),
      projectManifest,
      graphVersion: {
        commit: repo.indexedCommitSha,
        parserVersion: repo.parserVersion,
        graphSchemaVersion: repo.graphSchemaVersion,
      },
    });
  });
}

// -------------------------------------------------------------------- search

function registerSearchRoutes(app: Hono<AppContext>): void {
  app.post('/api/repositories/:id/search', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      mode?: 'hybrid' | 'exact' | 'semantic' | 'text';
      limit?: number;
      nodeTypes?: NodeType[];
    };
    if (!body.query) throw Errors.badRequest('`query` is required.');
    const search = createSearchService();
    const results = await search.search(repo.id, body.query, {
      mode: body.mode ?? 'hybrid',
      limit: Math.min(body.limit ?? 20, 100),
      ...(body.nodeTypes ? { nodeTypes: body.nodeTypes } : {}),
    });
    return c.json({ results });
  });
}

// -------------------------------------------------------------------- chat

/** Cheap deterministic hash so chip suggestions vary per repository. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Used when the repository has not been indexed yet. */
const GENERIC_SUGGESTIONS = [
  'What are the main entry points of this codebase?',
  'Which modules are the most connected?',
  'How does data flow from the UI to the server?',
  'What is the riskiest part of this codebase to change?',
];

function registerChatRoutes(app: Hono<AppContext>): void {
  /**
   * "Ask about this codebase" chips are derived from the indexed graph — real
   * routes, endpoints, services and hooks — instead of a fixed list that would
   * be wrong for every other repository.
   */
  app.get('/api/repositories/:id/suggestions', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const store = graphStore();
    const counts = await store.count(repo.id);
    if (counts.nodes === 0) {
      return c.json({ suggestions: GENERIC_SUGGESTIONS, source: 'generic', counts });
    }

    const nodes = await store.getNodesByRepository(repo.id, { limit: 6000 });
    const byType = (type: NodeType) => nodes.filter((n) => n.nodeType === type && n.name);

    const templates: Array<[NodeType, (name: string) => string]> = [
      ['route', (name) => `What happens when ${name} is requested?`],
      ['api_endpoint', (name) => `Where does ${name} send its data?`],
      ['service', (name) => `Which parts of the app call ${name}?`],
      ['component', (name) => `What renders ${name}, and what does it render?`],
      ['hook', (name) => `Where is ${name} used?`],
      ['store', (name) => `What reads from ${name}?`],
      ['middleware', (name) => `Which requests pass through ${name}?`],
      ['test', (name) => `What does ${name} cover, and what is missing?`],
    ];

    const suggestions: string[] = [];
    for (const [type, template] of templates) {
      const matches = byType(type);
      if (matches.length === 0) continue;
      const start = hashString(`${repo.id}:${type}`) % matches.length;
      for (let i = 0; i < matches.length && suggestions.length < 3; i++) {
        const question = template(matches[(start + i) % matches.length]!.name);
        if (!suggestions.includes(question) && question.length <= 90) suggestions.push(question);
      }
      if (suggestions.length >= 3) break;
    }

    const fillers = [...GENERIC_SUGGESTIONS];
    // One graph-grounded question that is not tied to a single node type.
    fillers.push(
      counts.nodes > 0
        ? `Walk me through the ${Math.min(counts.nodes, 999)}-node structure of this repository`
        : 'Walk me through the structure of this repository',
    );
    const fillerStart = hashString(repo.id) % fillers.length;
    for (let i = 0; i < fillers.length && suggestions.length < 5; i++) {
      const question = fillers[(fillerStart + i) % fillers.length]!;
      if (!suggestions.includes(question)) suggestions.push(question);
    }

    return c.json({ suggestions: suggestions.slice(0, 5), source: 'graph', counts });
  });
  app.post('/api/repositories/:id/chat', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const body = (await c.req.json().catch(() => ({}))) as {
      message?: string;
      maxNodes?: number;
      maxTokens?: number;
      depth?: number;
    };
    if (!body.message) throw Errors.badRequest('`message` is required.');
    if (!aiProvider()) {
      throw new AppError('AI_NOT_CONFIGURED', 'OPENROUTER_API_KEY is not configured; chat is unavailable.', 503);
    }

    const store = graphStore();
    const counts = await store.count(repo.id);
    if (counts.nodes === 0) throw Errors.notIndexed('This repository has not been indexed yet.');

    const search = createSearchService(store);
    const sources = sourceRegistry(repo.checkoutPath);
    const chat = chatService(store, search, sources);

    const partialGraph = repo.indexStatus === 'INDEXING' || repo.indexStatus === 'PARTIAL';
    const started = Date.now();
    const answer = await chat.ask(repo.id, body.message, {
      partialGraph,
      ...(body.depth ? { depth: body.depth } : {}),
      ...(body.maxNodes ? { maxNodes: body.maxNodes } : {}),
      ...(body.maxTokens ? { maxTokens: body.maxTokens } : {}),
    });

    if (usingDatabase()) {
      await db.writeAuditLog({
        organizationId: repo.organizationId,
        repositoryId: repo.id,
        action: 'ai.request_created',
        metadata: { kind: 'chat', latencyMs: Date.now() - started, references: answer.references.length },
        requestId: c.get('requestId'),
      });
    }

    return c.json({
      answer: answer.answer,
      references: answer.references,
      relationships: answer.relationships,
      canvasPath: answer.canvasPath,
      confidence: answer.confidence,
      partial: answer.partial,
      unverified: answer.unverified ?? false,
    });
  });
}

// -------------------------------------------------------------------- PRs & findings

interface DbPullRequestRow {
  id: string;
  github_pr_number: number;
  title: string | null;
  author: string | null;
  status: string;
  head_sha: string | null;
  updated_at: string;
}

function serializeReview(review: {
  id: string;
  prNumber: number;
  headSha: string;
  status: string;
  findings: unknown[];
  aiStatus: string;
  inlineComments: number;
  summaryCommentId: number | null;
  commentErrors: string[];
  error: string | null;
  startedAt: string;
  completedAt: string;
}) {
  return {
    id: review.id,
    status: review.status,
    headSha: review.headSha,
    findings: review.findings.length,
    aiStatus: review.aiStatus,
    inlineComments: review.inlineComments,
    summaryCommentId: review.summaryCommentId,
    commentErrors: review.commentErrors,
    error: review.error,
    startedAt: review.startedAt,
    completedAt: review.completedAt,
  };
}

function registerPrRoutes(app: Hono<AppContext>): void {
  /**
   * The PR list has to work with or without PostgreSQL: read the database when
   * it is up, always ask GitHub (App installation → GITHUB_TOKEN → anonymous),
   * and merge in whatever this service has reviewed locally.
   */
  async function collectPullRequests(repo: RepoRecord) {
    const access = await resolveGitHubAccess(repo.owner, repo.name);

    const [dbRows, dbReviews, ghPrs] = await Promise.all([
      usingDatabase()
        ? db
            .query<DbPullRequestRow>(
              `SELECT id, github_pr_number, title, author, status, head_sha, updated_at
               FROM pull_requests WHERE repository_id = $1 ORDER BY updated_at DESC LIMIT 50`,
              [repo.id],
            )
            .catch(() => [] as DbPullRequestRow[])
        : Promise.resolve([] as DbPullRequestRow[]),
      usingDatabase()
        ? db
            .query<{
              github_pr_number: number;
              id: string;
              status: string;
              head_sha: string;
              ai_status: string;
              summary: string | null;
              error: string | null;
              started_at: string | null;
              completed_at: string | null;
              findings: number;
            }>(
              `SELECT pr.github_pr_number, r.id, r.status, r.head_sha, r.ai_status, r.summary, r.error,
                      r.started_at, r.completed_at, COUNT(f.id)::int AS findings
               FROM pr_reviews r
               JOIN pull_requests pr ON pr.id = r.pull_request_id
               LEFT JOIN findings f ON f.pr_review_id = r.id
               WHERE pr.repository_id = $1
               GROUP BY pr.github_pr_number, r.id
               ORDER BY COALESCE(r.completed_at, r.started_at, r.created_at) DESC LIMIT 50`,
              [repo.id],
            )
            .catch(() => [] as Array<{ github_pr_number: number } & Record<string, unknown>>)
        : Promise.resolve([] as Array<{ github_pr_number: number } & Record<string, unknown>>),
      access.client.listPullRequests(repo.owner, repo.name, 'all').catch((e) => {
        log.warn('prs.list_failed', {
          repositoryId: repo.id,
          message: e instanceof Error ? e.message : String(e),
        });
        return [] as GitHubPullRequestSummary[];
      }),
    ]);

    type Row = {
      id: string;
      number: number;
      title: string | null;
      author: string | null;
      status: string;
      headSha: string | null;
      updatedAt: string;
      url: string;
      state: string;
      draft: boolean;
      baseBranch: string | null;
      headBranch: string | null;
      review: ReturnType<typeof serializeReview> | null;
    };

    const merged = new Map<number, Row>();
    const urlFor = (n: number) => `https://github.com/${repo.owner}/${repo.name}/pull/${n}`;

    for (const r of dbRows) {
      merged.set(r.github_pr_number, {
        id: r.id,
        number: r.github_pr_number,
        title: r.title,
        author: r.author,
        status: r.status,
        headSha: r.head_sha,
        updatedAt: r.updated_at,
        url: urlFor(r.github_pr_number),
        state: 'open',
        draft: false,
        baseBranch: null,
        headBranch: null,
        review: null,
      });
    }

    for (const pr of listMemoryPullRequests(repo.id)) {
      const existing = merged.get(pr.number);
      merged.set(pr.number, {
        id: existing?.id ?? `${repo.id}#${pr.number}`,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        status: existing?.status ?? (pr.state === 'open' ? 'OPEN' : pr.state.toUpperCase()),
        headSha: pr.headSha,
        updatedAt: pr.updatedAt,
        url: pr.url || urlFor(pr.number),
        state: pr.state,
        draft: pr.draft,
        baseBranch: pr.baseBranch,
        headBranch: pr.headBranch,
        review: existing?.review ?? null,
      });
    }

    for (const gh of ghPrs) {
      const existing = merged.get(gh.number);
      const record = {
        number: gh.number,
        title: gh.title,
        author: gh.author,
        state: gh.state,
        draft: gh.draft,
        baseBranch: gh.baseBranch,
        headBranch: gh.headBranch,
        baseSha: gh.baseSha,
        headSha: gh.headSha,
        url: gh.htmlUrl || urlFor(gh.number),
        updatedAt: gh.updatedAt,
      };
      if (!existing || existing.headSha !== gh.headSha) recordPullRequest(repo.id, record);
      merged.set(gh.number, {
        id: existing?.id ?? `${repo.id}#${gh.number}`,
        number: gh.number,
        title: gh.title,
        author: gh.author,
        status: existing?.status ?? (gh.state === 'open' ? 'OPEN' : gh.state.toUpperCase()),
        headSha: gh.headSha,
        updatedAt: gh.updatedAt,
        url: record.url,
        state: gh.state,
        draft: gh.draft,
        baseBranch: gh.baseBranch,
        headBranch: gh.headBranch,
        review: existing?.review ?? null,
      });
    }

    // Latest review per PR: local store first (works without a database),
    // database rows as a fallback.
    const reviews = new Map<number, ReturnType<typeof serializeReview>>();
    for (const review of listMemoryReviews(repo.id)) {
      if (!reviews.has(review.prNumber)) reviews.set(review.prNumber, serializeReview(review));
    }
    for (const row of dbReviews) {
      const number = row.github_pr_number;
      if (reviews.has(number)) continue;
      reviews.set(number, {
        id: String(row['id']),
        status: String(row['status']),
        headSha: String(row['head_sha'] ?? ''),
        findings: Number(row['findings'] ?? 0),
        aiStatus: String(row['ai_status'] ?? 'PENDING'),
        inlineComments: 0,
        summaryCommentId: null,
        commentErrors: [],
        error: (row['error'] as string | null) ?? null,
        startedAt: String(row['started_at'] ?? ''),
        completedAt: String(row['completed_at'] ?? ''),
      });
    }

    const pullRequests = [...merged.values()]
      .map((row) => ({ ...row, review: reviews.get(row.number) ?? null }))
      .sort((a, b) => b.number - a.number);

    return {
      pullRequests,
      commentCapability: access.capability,
      source: ghPrs.length > 0 || dbRows.length > 0 ? 'live' : 'none',
    };
  }

  app.get('/api/repositories/:id/prs', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    return c.json(await collectPullRequests(repo));
  });

  app.get('/api/repositories/:id/findings', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const dbFindings = usingDatabase()
      ? await db.listFindings(repo.id, limit).catch(() => [] as Awaited<ReturnType<typeof db.listFindings>>)
      : [];

    const seen = new Set(dbFindings.map((f) => `${f.file_path}:${f.line}:${f.title}`));
    const memory: ReviewFindingRecord[] = listMemoryFindings(repo.id, limit).filter((f) => {
      const key = `${f.filePath}:${f.line}:${f.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return c.json({
      findings: [
        ...dbFindings,
        ...memory.map((f) => ({
          id: `${repo.id}:${f.id}:${f.filePath}:${f.line}`,
          severity: f.severity,
          category: f.category,
          file_path: f.filePath,
          line: f.line,
          title: f.title,
          explanation: f.explanation,
          suggestion: f.suggestion,
          confidence: f.confidence,
          origin: f.origin,
          created_at: f.createdAt,
        })),
      ],
    });
  });

  /** Whether this server can post comments right now, and how to enable it. */
  app.get('/api/repositories/:id/github-capability', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const access = await resolveGitHubAccess(repo.owner, repo.name);
    return c.json({ owner: repo.owner, repository: repo.name, ...access.capability });
  });

  /**
   * Review status without touching GitHub — safe to poll while a review runs
   * without burning the unauthenticated rate limit.
   */
  app.get('/api/repositories/:id/reviews', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const jobs = jobQueue
      .list(repo.id)
      .filter((j) => j.kind === 'review')
      .map((j) => ({
        id: j.id,
        status: j.status,
        stage: j.stage,
        progress: j.progress,
        number: j.payload['pullRequestNumber'] ?? null,
        headSha: j.payload['headSha'] ?? null,
        error: j.error,
        result: j.result,
      }));
    return c.json({
      reviews: listMemoryReviews(repo.id).map(serializeReview),
      jobs,
      active: jobs.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING'),
    });
  });

  app.post('/api/repositories/:id/prs/:number/review', async (c) => {
    const repo = await requireRepo(c.req.param('id'), orgIdOf(c));
    const prNumber = Number(c.req.param('number'));
    const body = (await c.req.json().catch(() => ({}))) as {
      headSha?: string;
      baseSha?: string;
      checkoutPath?: string;
      postNewComment?: boolean;
    };
    const access = await resolveGitHubAccess(repo.owner, repo.name);

    let title = `PR #${prNumber}`;
    let baseSha = body.baseSha ?? null;
    let headSha = body.headSha ?? null;
    let baseBranch: string | null = null;
    try {
      const pr = await access.client.getPullRequest(repo.owner, repo.name, prNumber);
      title = pr.title;
      baseSha = body.baseSha ?? pr.baseSha;
      headSha = body.headSha ?? pr.headSha;
      baseBranch = pr.baseBranch;
      recordPullRequest(repo.id, {
        number: prNumber,
        title: pr.title,
        author: pr.author,
        state: pr.state,
        draft: pr.draft,
        baseBranch: pr.baseBranch,
        headBranch: pr.headBranch,
        baseSha: pr.baseSha,
        headSha: pr.headSha,
        url: `https://github.com/${repo.owner}/${repo.name}/pull/${prNumber}`,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      // A missing credential must not block a manually requested review — the
      // diff fetch inside the job has its own fallback.
      log.warn('pr.manual_metadata_failed', {
        repositoryId: repo.id,
        number: prNumber,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    if (!headSha) throw Errors.badRequest(`Could not resolve PR #${prNumber} on GitHub.`);
    if (baseBranch && baseBranch !== repo.branch && baseBranch !== repo.defaultBranch) {
      throw Errors.badRequest(
        `PR #${prNumber} targets "${baseBranch}", but this repository reviews PRs against "${repo.branch}".`,
      );
    }

    const reviewId = newReviewId();
    const now = new Date().toISOString();
    recordReview(repo.id, {
      id: reviewId,
      prNumber,
      headSha: headSha!,
      status: 'QUEUED',
      findings: [],
      summary: '',
      aiStatus: 'PENDING',
      inlineComments: 0,
      summaryCommentId: null,
      commentErrors: [],
      error: null,
      startedAt: now,
      completedAt: now,
    });

    const job = jobQueue.enqueue(
      'review',
      repo.id,
      {
        owner: repo.owner,
        repo: repo.name,
        pullRequestNumber: prNumber,
        title,
        baseSha,
        headSha: headSha!,
        checkoutPath: body.checkoutPath ?? repo.checkoutPath,
        reviewVersion: REVIEW_VERSION,
        reviewId,
        postNewComment: body.postNewComment === true,
      },
      c.get('requestId'),
    );
    return c.json({ job: serializeJob(job), reviewId, commentCapability: access.capability }, 202);
  });
}

// -------------------------------------------------------------------- webhooks

function registerWebhookRoutes(app: Hono<AppContext>): void {
  // GitHub is commonly configured with either path, and a mismatch here fails
  // silently (404) — so both are served by the same verified handler.
  const handleWebhook = async (c: Context<AppContext>): Promise<Response> => {
    const raw = await c.req.text();
    const secret = getConfig().github.webhookSecret;
    if (!secret) throw new AppError('WEBHOOK_NOT_CONFIGURED', 'GITHUB_WEBHOOK_SECRET is not configured.', 503);

    const signature = c.req.header('x-hub-signature-256');
    if (!verifyWebhookSignature(raw, signature, secret)) {
      log.warn('webhook.invalid_signature', { delivery: c.req.header('x-github-delivery') });
      throw Errors.webhookSignature();
    }

    const eventType = c.req.header('x-github-event') ?? '';
    const deliveryId = c.req.header('x-github-delivery') ?? uuid();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw Errors.badRequest('Malformed webhook payload.');
    }

    // Idempotency (doc §57/§159): never process the same delivery twice.
    if (usingDatabase()) {
      const { inserted } = await db.recordWebhookDelivery({ deliveryId, eventType });
      if (!inserted) return c.json({ ok: true, duplicate: true });
    }

    const event = normalizeWebhook(eventType, payload);
    if (!event) {
      if (usingDatabase()) await db.markWebhookProcessed(deliveryId);
      return c.json({ ok: true, ignored: true, eventType });
    }
    event.deliveryId = deliveryId;

    try {
      if (event.owner && event.repo) {
        const repos = await listRepos();
        const match = repos.find((r) => r.owner === event.owner && r.name === event.repo);

        // Gate on the branch this repository tracks, so only PRs aimed at it
        // are reviewed and commented on.
        if (
          match &&
          shouldTriggerReview(event, match.branch) &&
          event.pullRequestNumber &&
          event.headSha &&
          // Claim the head sha so a webhook delivery and the PR poller can
          // never queue the same review twice.
          claimForScheduling(match.id, event.pullRequestNumber, event.headSha)
        ) {
          jobQueue.enqueue(
          'review',
          match.id,
          {
            owner: event.owner,
            repo: event.repo,
            pullRequestNumber: event.pullRequestNumber,
            title: event.title ?? `PR #${event.pullRequestNumber}`,
            baseBranch: event.baseBranch,
            baseSha: event.baseSha,
            headSha: event.headSha,
            checkoutPath: match.checkoutPath,
            reviewVersion: REVIEW_VERSION,
          },
          c.get('requestId'),
        );
          if (usingDatabase()) {
            await db.writeAuditLog({
              organizationId: match.organizationId,
              repositoryId: match.id,
              action: 'pr.review_queued',
              metadata: { number: event.pullRequestNumber, action: event.action },
              requestId: c.get('requestId'),
            });
          }
        } else {
          log.warn('webhook.repository_not_connected', { owner: event.owner, repo: event.repo });
        }
      }
      if (usingDatabase()) await db.markWebhookProcessed(deliveryId);
    } catch (e) {
      if (usingDatabase()) await db.markWebhookProcessed(deliveryId, e instanceof Error ? e.message : String(e));
      throw e;
    }

    // Return quickly: analysis happens in the queue (doc §32).
    return c.json({ ok: true, event: event.kind, action: event.action });
  };

  app.post('/webhooks/github', handleWebhook);
  app.post('/api/github/webhook', handleWebhook);
  app.post('/api/webhooks/github', handleWebhook);
}

// -------------------------------------------------------------------- job handlers

function registerJobHandlers(): void {
  jobQueue.register('index', async (job, update) => {
    const repositoryId = job.repositoryId;
    const repo = await getRepo(repositoryId);
    if (!repo) throw new Error(`Repository ${repositoryId} not found for indexing.`);

    await updateRepo(repositoryId, { indexStatus: 'INDEXING', error: null });

    // Re-indexing should reflect what is on the remote, and a missing checkout
    // (deleted cache, fresh machine) is recoverable — clone it again.
    const incremental = Boolean(job.payload['incremental']);
    let checkoutPath = (job.payload['checkoutPath'] as string) ?? repo.checkoutPath;
    let commitSha = (job.payload['commitSha'] as string) ?? repo.indexedCommitSha ?? 'HEAD';

    if (!incremental) {
      update({ stage: 'CLONING', progress: 2 });
      try {
        const cred = await resolveCloneCredential({ owner: repo.owner, name: repo.name });
        const synced = await cloneOrPull({
          owner: repo.owner,
          name: repo.name,
          branch: repo.branch,
          token: cred.token,
          existingPath: checkoutPath,
        });
        checkoutPath = synced.checkoutPath;
        if (!job.payload['commitSha'] && synced.commitSha) commitSha = synced.commitSha;
      } catch (e) {
        // A local checkout that already exists is fine even if GitHub is down;
        // only fail when there is genuinely nothing to index.
        if (!existsSync(checkoutPath)) {
          const err = new AppError(
            'CLONE_FAILED',
            e instanceof Error ? e.message : `Could not fetch ${repo.owner}/${repo.name}.`,
            502,
          );
          await updateRepo(repositoryId, { indexStatus: 'FAILED', error: err.message });
          throw err;
        }
        log.warn('indexer.sync_skipped', { repositoryId, message: e instanceof Error ? e.message : String(e) });
      }
    }

    const changedFiles = (job.payload['changedFiles'] as string[]) ?? [];

    let dbJobId: string | null = null;
    if (usingDatabase()) {
      try {
        const row = await db.createIndexingJob({ repositoryId, commitSha, incremental, requestId: job.requestId });
        dbJobId = row.id;
        await db.updateIndexingJob(dbJobId, { stage: 'DISCOVERING', status: 'RUNNING', startedAt: new Date() });
      } catch (e) {
        log.warn('indexer.db_job_failed', { message: e instanceof Error ? e.message : String(e) });
      }
    }

    try {
      const repoConfig = repo.repositoryConfig as {
        analysis?: { include?: string[]; exclude?: string[]; includeGenerated?: boolean };
      };

      const result = await runIndexingJob({
        repositoryId,
        root: checkoutPath,
        commitSha,
        store: graphStore(),
        incremental,
        changedFiles,
        analyzeOptions: {
          ...(repoConfig.analysis?.include ? { include: repoConfig.analysis.include } : {}),
          ...(repoConfig.analysis?.exclude ? { exclude: repoConfig.analysis.exclude } : {}),
          includeGenerated: repoConfig.analysis?.includeGenerated ?? false,
        },
        persistToDatabase: usingDatabase(),
        onProgress: (p) => {
          update({
            stage: p.stage,
            progress: p.progress,
            filesProcessed: p.filesProcessed,
            filesTotal: p.filesTotal,
            nodesCreated: p.nodesCreated,
            edgesCreated: p.edgesCreated,
          });
          if (dbJobId) {
            void db
              .updateIndexingJob(dbJobId, {
                stage: p.stage,
                progress: p.progress,
                files_processed: p.filesProcessed,
                files_total: p.filesTotal,
                nodes_created: p.nodesCreated,
                edges_created: p.edgesCreated,
              })
              .catch(() => undefined);
          }
        },
      });

      await updateRepo(repositoryId, {
        indexStatus: result.validation.status === 'failed' ? 'FAILED' : 'READY',
        indexedCommitSha: result.commitSha,
        parserVersion: result.parserVersion,
        graphSchemaVersion: result.graphSchemaVersion,
        lastIndexedAt: new Date().toISOString(),
        error: null,
      });
      if (usingDatabase()) {
        const pool = db.getPool();
        await pool.query('DELETE FROM project_conventions WHERE repository_id = $1', [repositoryId]).catch(() => undefined);
        for (const convention of result.conventions) {
          await pool
            .query(
              `INSERT INTO project_conventions (repository_id, name, description, examples, confidence)
               VALUES ($1,$2,$3,$4,$5)`,
              [repositoryId, convention.name, convention.description, JSON.stringify(convention.examples), convention.confidence],
            )
            .catch(() => undefined);
        }
        if (dbJobId) {
          await db
            .updateIndexingJob(dbJobId, {
              status: 'COMPLETED',
              stage: 'READY',
              progress: 100,
              files_processed: result.filesParsed,
              nodes_created: result.nodes,
              edges_created: result.edges,
              completedAt: new Date(),
            })
            .catch(() => undefined);
        }
        await db.writeAuditLog({
          organizationId: repo.organizationId,
          repositoryId,
          action: 'index.completed',
          metadata: {
            nodes: result.nodes,
            edges: result.edges,
            files: result.filesParsed,
            durationMs: result.durationMs,
            warnings: result.validation.warnings,
          },
          requestId: job.requestId,
        });
      }
      return {
        nodes: result.nodes,
        edges: result.edges,
        files: result.filesParsed,
        commitSha: result.commitSha,
        validation: result.validation,
        architecture: result.architecture,
      };
    } catch (e) {
      await updateRepo(repositoryId, { indexStatus: 'FAILED', error: e instanceof Error ? e.message : String(e) });
      if (usingDatabase() && dbJobId) {
        await db
          .updateIndexingJob(dbJobId, { status: 'FAILED', stage: 'FAILED', error: e instanceof Error ? e.message : String(e), completedAt: new Date() })
          .catch(() => undefined);
      }
      throw e;
    }
  });

  jobQueue.register('review', async (job, update) => {
    const repositoryId = job.repositoryId;
    const repo = await getRepo(repositoryId);
    if (!repo) throw new Error(`Repository ${repositoryId} not found for review.`);
    const ai = aiProvider();
    update({ stage: 'FRAMEWORK_ANALYSIS', progress: 20 });

    const store = graphStore();
    const counts = await store.count(repositoryId);
    const sources = sourceRegistry((job.payload['checkoutPath'] as string) ?? repo.checkoutPath);

    let conventions: Convention[] = [];
    if (usingDatabase()) {
      const rows = await db.query<{ name: string; description: string; examples: unknown; confidence: number }>(
        'SELECT name, description, examples, confidence FROM project_conventions WHERE repository_id = $1',
        [repositoryId],
      );
      conventions = rows.map((r) => ({
        name: r.name,
        description: r.description,
        examples: (r.examples ?? []) as Convention['examples'],
        confidence: r.confidence,
      }));
    }

    const reviewConfig = (repo.repositoryConfig as { review?: RuleConfig & { enabled?: boolean } }).review;
    if (reviewConfig?.enabled === false) {
      update({ stage: 'READY', progress: 100 });
      return { skipped: true, reason: 'review disabled by repository configuration' };
    }

    update({ stage: 'API_ANALYSIS', progress: 45 });

    const prNumber = job.payload['pullRequestNumber'] as number;
    const headSha = job.payload['headSha'] as string;
    const baseSha = (job.payload['baseSha'] as string | null) ?? null;
    const reviewId = (job.payload['reviewId'] as string) ?? newReviewId();
    const startedAt = new Date().toISOString();

    // Mirror the run locally so the PR page shows progress and — if the
    // database is down — still shows the result afterwards.
    recordPullRequest(repositoryId, {
      number: prNumber,
      title: (job.payload['title'] as string) || `PR #${prNumber}`,
      author: null,
      state: 'open',
      draft: false,
      baseBranch: (job.payload['baseBranch'] as string) ?? repo.branch,
      headBranch: '',
      baseSha,
      headSha,
      url: `https://github.com/${repo.owner}/${repo.name}/pull/${prNumber}`,
      updatedAt: startedAt,
    });
    recordReview(repositoryId, {
      id: reviewId,
      prNumber,
      headSha,
      status: 'RUNNING',
      findings: [],
      summary: '',
      aiStatus: 'PENDING',
      inlineComments: 0,
      summaryCommentId: null,
      commentErrors: [],
      error: null,
      startedAt,
      completedAt: startedAt,
    });

    try {
      const access = await resolveGitHubAccess(job.payload['owner'] as string, job.payload['repo'] as string);
      const result = await runReviewJob({
        repositoryId,
        owner: job.payload['owner'] as string,
        repo: job.payload['repo'] as string,
        pullRequestNumber: prNumber,
        title: (job.payload['title'] as string) ?? '',
        baseSha,
        headSha,
        store,
        sources,
        github: access.client,
        appUrl: getConfig().appUrl,
        postNewComment: job.payload['postNewComment'] === true,
        ...(ai ? { ai } : {}),
        conventions,
        ruleConfig: reviewConfig ?? {},
        ...(reviewConfig?.minimumConfidence ? { minimumConfidence: reviewConfig.minimumConfidence } : {}),
        graphIsPartial: repo.indexStatus !== 'READY' || counts.nodes === 0,
        persist: usingDatabase(),
      });

      releaseScheduled(repositoryId, prNumber, headSha);
      if (result.duplicate) {
        update({ stage: 'READY', progress: 100 });
        return { duplicate: true, findings: 0 };
      }
      // Note: a re-run does not create a second comment — the single review
      // comment is edited in place, so this path always ends with exactly one.
      const completedAt = new Date().toISOString();
      recordReview(repositoryId, {
        id: result.reviewId ?? reviewId,
        prNumber,
        headSha,
        status: 'COMPLETED',
        findings: result.outcome.accepted.map(toFindingRecord),
        summary: result.outcome.summary,
        aiStatus: result.outcome.aiStatus,
        inlineComments: result.inlineCommentIds.length,
        summaryCommentId: result.summaryCommentId,
        commentErrors: result.commentErrors,
        error: null,
        startedAt,
        completedAt,
      });
      if (result.commentErrors.length > 0) {
        log.warn('review.comments_not_posted', {
          repositoryId,
          number: prNumber,
          capability: access.capability.mode,
          message: result.commentErrors[0],
        });
      }

      update({ stage: 'VALIDATING', progress: 90, nodesCreated: result.postedFindings });
      return {
        findings: result.postedFindings,
        aiStatus: result.outcome.aiStatus,
        changedFiles: result.outcome.parsedDiff.changedFiles.length,
        impact: { direct: result.outcome.impact.direct.length, indirect: result.outcome.impact.indirect.length },
        commentsPosted: result.summaryCommentId !== null,
        commentUpdated: result.alreadyPosted,
        commentErrors: result.commentErrors,
        duplicate: false,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      releaseScheduled(repositoryId, prNumber, headSha);
      recordReview(repositoryId, {
        id: reviewId,
        prNumber,
        headSha,
        status: 'FAILED',
        findings: [],
        summary: '',
        aiStatus: 'SKIPPED',
        inlineComments: 0,
        summaryCommentId: null,
        commentErrors: [],
        error: message,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      throw e;
    }
  });
}


