import { CONFIDENCE, makeEdge, makeNode, type GraphEdge, type GraphNode } from '@cbi/shared';
import type { ParsedFile } from '@cbi/parser';
import {
  findSymbol,
  normalizePathTemplate,
  resolveCallerSymbol,
  routePathFromAppFile,
  routePathFromPagesFile,
  type AnalysisContext,
} from './context.js';
import type { ApiEndpointInfo, RouteInfo } from './types.js';

export interface FrameworkContribution {
  nodes: GraphNode[];
  edges: GraphEdge[];
  apiEndpoints: ApiEndpointInfo[];
  routes: RouteInfo[];
}

interface EndpointAccumulator {
  node: GraphNode;
  info: ApiEndpointInfo;
}

const ROUTE_HANDLER_RE = /(^|\/)(?:src\/)?app\/.*\/route\.(ts|tsx|js|jsx)$/;
const APP_PAGE_RE = /(^|\/)(?:src\/)?app\/.*\/page\.(ts|tsx|js|jsx)$/;
const PAGES_API_RE = /(^|\/)(?:src\/)?pages\/api\/.*\.(ts|tsx|js|jsx)$/;
const PAGES_PAGE_RE = /(^|\/)(?:src\/)?pages\/(?!api\/|_app|_document|_error).*\.(tsx|jsx|js)$/;

function isDynamicRoute(path: string): boolean {
  return path.includes('{');
}

/** Pick the most likely page component rendered by a route file. */
function pageComponent(file: ParsedFile, ctx: AnalysisContext): GraphNode | null {
  const symbols = file.symbols.filter((s) => s.kind === 'component');
  if (symbols.length === 0) return null;
  const preferred = symbols.find((s) => s.exported) ?? symbols[0]!;
  return findSymbol(ctx, file.filePath, preferred.name);
}

export function analyzeFramework(ctx: AnalysisContext): FrameworkContribution {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const endpoints = new Map<string, EndpointAccumulator>();
  const routes = new Map<string, { node: GraphNode; info: RouteInfo }>();
  const repoId = ctx.repositoryId;

  const fileNode = (filePath: string): GraphNode | null => ctx.fileIndex.get(filePath) ?? null;

  const upsertEndpoint = (
    method: string,
    path: string,
    kind: 'client' | 'server',
    filePath: string,
    startLine: number,
    handlerName: string | null,
    evidence: string,
    confidence: number,
  ): EndpointAccumulator => {
    const key = `${method} ${path}`;
    const existing = endpoints.get(key);
    if (existing) {
      const prevKind = existing.node.metadata['kind'];
      if (prevKind !== kind) existing.node.metadata['kind'] = 'both';
      if (kind === 'server') {
        existing.node.metadata['handlerFile'] = filePath;
        existing.node.metadata['handlerName'] = handlerName;
      }
      return existing;
    }
    const node = makeNode({
      repositoryId: repoId,
      nodeType: 'api_endpoint',
      name: key,
      metadata: { method, path, kind, handlerFile: kind === 'server' ? filePath : null, handlerName },
    });
    const acc: EndpointAccumulator = {
      node,
      info: { nodeId: node.id, method, path, filePath, handlerName, startLine, kind, evidence, confidence },
    };
    endpoints.set(key, acc);
    return acc;
  };

  const upsertRoute = (
    path: string,
    filePath: string | null,
    componentName: string | null,
    kind: RouteInfo['kind'],
    evidence: string,
    confidence: number,
  ): { node: GraphNode; info: RouteInfo } => {
    const existing = routes.get(path);
    if (existing) {
      if (!existing.node.metadata['filePath'] && filePath) existing.node.metadata['filePath'] = filePath;
      if (!existing.node.metadata['component'] && componentName) existing.node.metadata['component'] = componentName;
      if (existing.node.metadata['kind'] === 'inferred-navigation' && kind !== 'inferred-navigation') {
        existing.node.metadata['kind'] = kind;
      }
      return existing;
    }
    const node = makeNode({
      repositoryId: repoId,
      nodeType: 'route',
      name: path,
      metadata: { path, kind, filePath, component: componentName, dynamic: isDynamicRoute(path) },
    });
    const info: RouteInfo = {
      nodeId: node.id,
      path,
      filePath: filePath ?? '',
      componentName,
      kind,
      dynamic: isDynamicRoute(path),
      evidence,
      confidence,
    };
    const entry = { node, info };
    routes.set(path, entry);
    return entry;
  };

  for (const file of ctx.analyzed.files) {
    const filePath = file.filePath;

    // ---------------- Next.js App Router route handlers ----------------
    if (ROUTE_HANDLER_RE.test(filePath)) {
      const path = routePathFromAppFile(filePath) ?? '/';
      for (const method of file.frameworks.routeHandlerExports) {
        const acc = upsertEndpoint(
          method,
          path,
          'server',
          filePath,
          1,
          method,
          `${filePath}: export async function ${method}() -> ${method} ${path}`,
          CONFIDENCE.deterministic,
        );
        const handler = findSymbol(ctx, filePath, method);
        if (handler) {
          edges.push(
            makeEdge({
              repositoryId: repoId,
              edgeType: 'IMPLEMENTS',
              sourceNodeId: handler.id,
              targetNodeId: acc.node.id,
              evidence: `${method}() implements the ${method} ${path} route handler`,
              confidence: CONFIDENCE.deterministic,
              sourceFile: filePath,
              sourceLine: handler.startLine ?? 1,
            }),
          );
        }
        const fn = fileNode(filePath);
        if (fn) {
          edges.push(
            makeEdge({
              repositoryId: repoId,
              edgeType: 'DEFINED_IN',
              sourceNodeId: acc.node.id,
              targetNodeId: fn.id,
              evidence: `${method} ${path} handler defined in ${filePath}`,
              confidence: CONFIDENCE.deterministic,
              sourceFile: filePath,
              sourceLine: 1,
            }),
          );
        }
      }
    }

    // ---------------- Next.js Pages Router API ----------------
    if (PAGES_API_RE.test(filePath)) {
      const path = routePathFromPagesFile(filePath) ?? '/';
      const acc = upsertEndpoint(
        'ALL',
        path,
        'server',
        filePath,
        1,
        null,
        `${filePath}: Pages Router API handler for ${path}`,
        CONFIDENCE.probable,
      );
      const fn = fileNode(filePath);
      if (fn) {
        edges.push(
          makeEdge({
            repositoryId: repoId,
            edgeType: 'DEFINED_IN',
            sourceNodeId: acc.node.id,
            targetNodeId: fn.id,
            evidence: `${path} handled by ${filePath}`,
            confidence: CONFIDENCE.probable,
            extractionMethod: 'framework_convention',
            sourceFile: filePath,
            sourceLine: 1,
          }),
        );
      }
    }

    // ---------------- Express / Fastify server routes ----------------
    for (const route of file.frameworks.serverRouteCalls) {
      const path = normalizePathTemplate(route.path);
      const acc = upsertEndpoint(
        route.method,
        path,
        'server',
        filePath,
        route.line,
        route.handlerName,
        `${route.receiver}.${route.method.toLowerCase()}('${route.path}', ${route.handlerName ?? 'handler'})`,
        CONFIDENCE.strongStatic,
      );
      const handler =
        (route.handlerName ? findSymbol(ctx, filePath, route.handlerName) : null) ??
        resolveCallerSymbol(ctx, filePath, route.caller, route.line);
      if (handler) {
        edges.push(
          makeEdge({
            repositoryId: repoId,
            edgeType: 'IMPLEMENTS',
            sourceNodeId: handler.id,
            targetNodeId: acc.node.id,
            evidence: `${handler.name} handles ${route.method} ${path}`,
            confidence: CONFIDENCE.strongStatic,
            sourceFile: filePath,
            sourceLine: route.line,
          }),
        );
      }
      const fn = fileNode(filePath);
      if (fn) {
        edges.push(
          makeEdge({
            repositoryId: repoId,
            edgeType: 'DEFINED_IN',
            sourceNodeId: acc.node.id,
            targetNodeId: fn.id,
            evidence: `${route.method} ${path} registered in ${filePath}`,
            confidence: CONFIDENCE.strongStatic,
            sourceFile: filePath,
            sourceLine: route.line,
          }),
        );
      }
    }

    // ---------------- Client HTTP calls ----------------
    for (const call of file.frameworks.httpCallTargets) {
      const method = call.method ?? 'GET';
      const path = normalizePathTemplate(call.url);
      const confidence = call.client === 'fetch' || call.client === 'axios' ? CONFIDENCE.strongStatic : CONFIDENCE.probable;
      const acc = upsertEndpoint(
        method,
        path,
        'client',
        filePath,
        call.line,
        call.caller,
        `${call.client} call to ${method} ${path}`,
        confidence,
      );
      const source = resolveCallerSymbol(ctx, filePath, call.caller, call.line);
      if (source) {
        edges.push(
          makeEdge({
            repositoryId: repoId,
            edgeType: 'CALLS_API',
            sourceNodeId: source.id,
            targetNodeId: acc.node.id,
            evidence: `${call.client}('${call.url}') -> ${method} ${path}`,
            confidence,
            sourceFile: filePath,
            sourceLine: call.line,
            sourceColumn: call.column,
          }),
        );
      }
    }

    // ---------------- Client navigation ----------------
    for (const nav of file.frameworks.navigationCalls) {
      const path = normalizePathTemplate(nav.target);
      const entry = upsertRoute(
        path,
        null,
        null,
        'inferred-navigation',
        `${nav.kind}('${nav.target}') in ${filePath}`,
        CONFIDENCE.probable,
      );
      const source = resolveCallerSymbol(ctx, filePath, nav.caller, nav.line);
      if (source) {
        edges.push(
          makeEdge({
            repositoryId: repoId,
            edgeType: 'NAVIGATES_TO',
            sourceNodeId: source.id,
            targetNodeId: entry.node.id,
            evidence: `${nav.kind}('${nav.target}')`,
            confidence: CONFIDENCE.strongStatic,
            sourceFile: filePath,
            sourceLine: nav.line,
          }),
        );
      }
    }

    // ---------------- Next.js pages (App + Pages router) ----------------
    if (APP_PAGE_RE.test(filePath)) {
      const path = routePathFromAppFile(filePath) ?? '/';
      const component = pageComponent(file, ctx);
      const entry = upsertRoute(
        path,
        filePath,
        component?.name ?? null,
        'nextjs-app',
        `${filePath} renders route ${path}`,
        CONFIDENCE.deterministic,
      );
      const fn = fileNode(filePath);
      if (fn) {
        edges.push(
          makeEdge({
            repositoryId: repoId,
            edgeType: 'DEFINED_IN',
            sourceNodeId: entry.node.id,
            targetNodeId: fn.id,
            evidence: `route ${path} defined by ${filePath}`,
            confidence: CONFIDENCE.deterministic,
            extractionMethod: 'framework_convention',
            sourceFile: filePath,
            sourceLine: 1,
          }),
        );
      }
      if (component) {
        edges.push(
          makeEdge({
            repositoryId: repoId,
            edgeType: 'RENDERS',
            sourceNodeId: entry.node.id,
            targetNodeId: component.id,
            evidence: `route ${path} renders ${component.name}`,
            confidence: CONFIDENCE.probable,
            extractionMethod: 'framework_convention',
            sourceFile: filePath,
            sourceLine: component.startLine ?? 1,
          }),
        );
      }
    } else if (PAGES_PAGE_RE.test(filePath)) {
      const path = routePathFromPagesFile(filePath);
      if (path) {
        const component = pageComponent(file, ctx);
        const entry = upsertRoute(
          path,
          filePath,
          component?.name ?? null,
          'nextjs-pages',
          `${filePath} renders page ${path}`,
          CONFIDENCE.probable,
        );
        const fn = fileNode(filePath);
        if (fn) {
          edges.push(
            makeEdge({
              repositoryId: repoId,
              edgeType: 'DEFINED_IN',
              sourceNodeId: entry.node.id,
              targetNodeId: fn.id,
              evidence: `page ${path} defined by ${filePath}`,
              confidence: CONFIDENCE.probable,
              extractionMethod: 'framework_convention',
              sourceFile: filePath,
              sourceLine: 1,
            }),
          );
        }
        if (component) {
          edges.push(
            makeEdge({
              repositoryId: repoId,
              edgeType: 'RENDERS',
              sourceNodeId: entry.node.id,
              targetNodeId: component.id,
              evidence: `page ${path} renders ${component.name}`,
              confidence: CONFIDENCE.probable,
              extractionMethod: 'framework_convention',
              sourceFile: filePath,
              sourceLine: component.startLine ?? 1,
            }),
          );
        }
      }
    }
  }

  // ---- link client call sites to the server route handler that serves them ----
  // A client path is often relative to an API base URL, so we link by suffix:
  // `/patient/{id}/discharge` is served by `/api/patient/{id}/discharge`.
  const allEndpoints = [...endpoints.values()];
  const serverEndpoints = allEndpoints.filter((e) => e.info.kind === 'server');
  const clientEndpoints = allEndpoints.filter((e) => e.info.kind === 'client');
  const mergedClientToServer = new Map<string, string>();

  for (const client of clientEndpoints) {
    if (client.info.path === '/') continue;
    const candidates = serverEndpoints.filter(
      (s) => s.info.method === client.info.method && (s.info.path === client.info.path || s.info.path.endsWith(client.info.path)),
    );
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.info.path.length - a.info.path.length);
    const target = candidates[0]!;
    mergedClientToServer.set(client.node.id, target.node.id);
    target.node.metadata['kind'] = 'both';
    target.node.metadata['clientPath'] = client.info.path;
    target.info.kind = 'both';
  }

  const linkedEdges: GraphEdge[] = [];
  const seenEdgeIds = new Set<string>();
  for (const edge of edges) {
    const serverId = mergedClientToServer.get(edge.targetNodeId);
    const finalEdge = serverId
      ? makeEdge({
          repositoryId: repoId,
          edgeType: edge.edgeType,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: serverId,
          evidence: edge.evidence,
          confidence: Math.min(edge.confidence, CONFIDENCE.probable),
          extractionMethod: edge.extractionMethod,
          sourceFile: edge.sourceFile,
          sourceLine: edge.sourceLine,
          sourceColumn: edge.sourceColumn,
          metadata: { ...edge.metadata, linkedToServer: true },
        })
      : edge;
    if (seenEdgeIds.has(finalEdge.id)) continue;
    seenEdgeIds.add(finalEdge.id);
    linkedEdges.push(finalEdge);
  }

  for (const clientId of mergedClientToServer.keys()) endpoints.delete(endpointKeyFor(clientId, endpoints));

  for (const { node } of endpoints.values()) nodes.push(node);
  for (const { node } of routes.values()) nodes.push(node);

  return {
    nodes,
    edges: linkedEdges,
    apiEndpoints: [...endpoints.values()].map((e) => e.info),
    routes: [...routes.values()].map((r) => r.info),
  };
}

function endpointKeyFor(nodeId: string, endpoints: Map<string, EndpointAccumulator>): string {
  for (const [key, acc] of endpoints) {
    if (acc.node.id === nodeId) return key;
  }
  return '';
}
