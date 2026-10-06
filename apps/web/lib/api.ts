export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export interface ApiNode {
  id: string;
  nodeType: string;
  name: string;
  qualifiedName: string;
  filePath: string | null;
  language: string | null;
  startLine: number | null;
  endLine: number | null;
  metadata: Record<string, unknown>;
}

export interface ApiEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  confidence: number;
  evidence: string;
  sourceFile: string | null;
  sourceLine: number | null;
  extractionMethod: string;
}

export interface GraphPayload {
  scope: string;
  nodes: ApiNode[];
  edges: ApiEdge[];
  truncated: boolean;
  counts: { nodes: number; edges: number };
}

export interface DependencyEntry {
  name: string;
  version: string;
  dev: boolean;
  category: string;
}

export interface WorkspacePackage {
  name: string;
  path: string;
  private: boolean;
  dependencies: number;
}

export interface ProjectManifest {
  projectType: string;
  packageManager: string | null;
  lockfile: string | null;
  name: string | null;
  scripts: Array<{ name: string; command: string }>;
  runtime: DependencyEntry[];
  dev: DependencyEntry[];
  workspaces: WorkspacePackage[];
  manifests: number;
  empty: boolean;
}

export interface RepositoryPayload {
  id: string;
  owner: string;
  name: string;
  branch: string;
  defaultBranch: string;
  indexedCommitSha: string | null;
  indexStatus: string;
  parserVersion: string | null;
  graphSchemaVersion: number | null;
  lastIndexedAt: string | null;
  error: string | null;
  checkoutPath: string;
  latestJob?: JobPayload | null;
}

export interface JobPayload {
  id: string;
  kind: string;
  status: string;
  stage: string;
  progress: number;
  filesProcessed: number;
  filesTotal: number;
  nodesCreated: number;
  edgesCreated: number;
  error: string | null;
}

export interface NodeDetailPayload {
  node: ApiNode;
  outgoing: ApiEdge[];
  incoming: ApiEdge[];
  neighbors: ApiNode[];
  evidence: { filePath: string; startLine: number; endLine: number; snippet: string } | null;
}

export interface ChatPayload {
  answer: string;
  references: Array<{ nodeId: string | null; filePath: string; startLine: number; endLine: number; symbol: string | null; snippet: string }>;
  relationships: Array<{ from: string; relationship: string; to: string }>;
  canvasPath: string[];
  confidence: number;
  partial: boolean;
  unverified: boolean;
}

export interface SearchPayload {
  results: Array<{
    nodeId: string;
    nodeType: string;
    name: string;
    filePath: string | null;
    startLine: number | null;
    endLine: number | null;
    score: number;
  }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listRepositories: () => request<{ repositories: RepositoryPayload[] }>('/api/repositories'),
  getRepository: (id: string) => request<{ repository: RepositoryPayload; latestJob: JobPayload | null }>(`/api/repositories/${id}`),
  createRepository: (input: {
    owner?: string;
    name?: string;
    branch?: string;
    checkoutPath?: string;
    repoUrl?: string;
    autoIndex?: boolean;
  }) =>
    request<{ repository: RepositoryPayload; latestJob: JobPayload | null; cloned: boolean }>('/api/repositories', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  checkAccess: (repoUrl: string) =>
    request<{
      owner: string;
      name: string;
      appConfigured: boolean;
      accessible: boolean | null;
      requiresInstall: boolean;
      installationId?: number | null;
      message: string;
    }>('/api/github/access', { method: 'POST', body: JSON.stringify({ repoUrl }) }),
  startIndex: (id: string, input: { checkoutPath?: string; incremental?: boolean; commitSha?: string } = {}) =>
    request<{ job: JobPayload }>(`/api/repositories/${id}/index`, { method: 'POST', body: JSON.stringify(input) }),
  indexStatus: (id: string, jobId?: string) =>
    request<{ repository: RepositoryPayload; job: JobPayload | null }>(`/api/repositories/${id}/index${jobId ? `?jobId=${jobId}` : ''}`),
  graph: (id: string, params: { scope?: string; limit?: number; nodeTypes?: string; edgeTypes?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.scope) qs.set('scope', params.scope);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.nodeTypes) qs.set('nodeTypes', params.nodeTypes);
    if (params.edgeTypes) qs.set('edgeTypes', params.edgeTypes);
    return request<GraphPayload>(`/api/repositories/${id}/graph?${qs.toString()}`);
  },
  node: (id: string, nodeId: string) => request<NodeDetailPayload>(`/api/repositories/${id}/nodes/${nodeId}`),
  neighborhood: (id: string, nodeId: string, params: { depth?: number; direction?: string; edgeTypes?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.depth) qs.set('depth', String(params.depth));
    if (params.direction) qs.set('direction', params.direction);
    if (params.edgeTypes) qs.set('edgeTypes', params.edgeTypes);
    return request<{ nodes: ApiNode[]; edges: ApiEdge[]; truncated: boolean }>(`/api/repositories/${id}/nodes/${nodeId}/neighborhood?${qs.toString()}`);
  },
  path: (id: string, from: string, to: string) =>
    request<{ found: boolean; nodes: ApiNode[]; edges: ApiEdge[]; length: number }>(`/api/repositories/${id}/paths?from=${from}&to=${to}`),
  search: (id: string, query: string, mode = 'hybrid') =>
    request<SearchPayload>(`/api/repositories/${id}/search`, { method: 'POST', body: JSON.stringify({ query, mode, limit: 15 }) }),
  chat: (id: string, message: string) =>
    request<ChatPayload>(`/api/repositories/${id}/chat`, { method: 'POST', body: JSON.stringify({ message }) }),
  /** Questions derived from the indexed graph for the chat welcome state. */
  suggestions: (id: string) =>
    request<{ suggestions: string[]; source: string; counts: { nodes: number; edges: number } }>(
      `/api/repositories/${id}/suggestions`,
    ),
  architecture: (id: string) =>
    request<{
      counts: { nodes: number; edges: number };
      routes: Array<{ path: string; kind?: string }>;
      endpoints: Array<{ label: string; method?: string; path?: string; kind?: string }>;
      services: Array<{ name: string; filePath: string | null }>;
      packages: string[];
      projectManifest: ProjectManifest;
      graphVersion: { commit: string | null; parserVersion: string | null; graphSchemaVersion: number | null };
    }>(`/api/repositories/${id}/architecture`),
};
