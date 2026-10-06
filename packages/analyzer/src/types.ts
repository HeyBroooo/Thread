import type { GraphEdge, GraphNode } from '@cbi/shared';

export interface ApiEndpointInfo {
  nodeId: string;
  method: string;
  path: string;
  filePath: string;
  handlerName: string | null;
  startLine: number;
  /** client = an HTTP call target; server = a route handler; both = linked. */
  kind: 'client' | 'server' | 'both';
  evidence: string;
  confidence: number;
}

export interface RouteInfo {
  nodeId: string;
  /** Framework route path, e.g. /patients/[id] normalized to /patients/{id}. */
  path: string;
  filePath: string;
  componentName: string | null;
  kind: 'nextjs-app' | 'nextjs-pages' | 'react-router' | 'inferred-navigation';
  dynamic: boolean;
  evidence: string;
  confidence: number;
}

export interface ArchitectureSummary {
  frontend: string[];
  backend: string[];
  state: string[];
  api: string[];
  routing: string;
  authentication: string[];
  testing: string[];
  services: string[];
  packageManager: string | null;
  monorepo: boolean;
  packages: Array<{ name: string; path: string }>;
}

export interface Convention {
  name: string;
  description: string;
  examples: Array<{ filePath: string; startLine: number; endLine: number; snippet: string; symbol: string | null }>;
  confidence: number;
}

export interface UnsupportedInfo {
  /** Languages present that are not yet analyzed (doc §130). */
  skippedLanguages: string[];
  skippedFileCount: number;
  generatedFileCount: number;
  unsupportedDynamicRelationships: number;
}

export interface AnalysisResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  apiEndpoints: ApiEndpointInfo[];
  routes: RouteInfo[];
  architecture: ArchitectureSummary;
  conventions: Convention[];
  unsupported: UnsupportedInfo;
  /** High-confidence deterministic violations detected at index time. */
  stats: {
    serverEndpoints: number;
    clientEndpoints: number;
    routes: number;
    conventions: number;
  };
}

export const FRAMEWORK_ANALYZER_VERSION = '1.0.0';
