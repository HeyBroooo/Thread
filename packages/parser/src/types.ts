import type { NodeType } from '@cbi/shared';

/** Version of the parser. Bump when the graph output changes (doc §73/§154). */
export const PARSER_VERSION = '1.0.0';
export const GRAPH_SCHEMA_VERSION = 1;

export type RawSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'variable'
  | 'component'
  | 'hook'
  | 'context'
  | 'store';

export interface ParsedSymbol {
  kind: RawSymbolKind;
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  isAsync: boolean;
  hasJsx: boolean;
  /** Detected React hook calls, e.g. useState, useEffect, usePatient. */
  hookCalls: string[];
  metadata: Record<string, unknown>;
}

export interface ParsedImport {
  moduleSpecifier: string;
  line: number;
  defaultImport: string | null;
  namespaceImport: string | null;
  namedImports: Array<{ name: string; alias: string | null }>;
  typeOnly: boolean;
  resolvedFilePath: string | null;
  /** How the specifier was resolved, for evidence/confidence. */
  resolution: 'relative' | 'alias' | 'package' | 'unresolved';
}

export interface ParsedExport {
  name: string;
  kind: string;
  line: number;
  isDefault: boolean;
}

export interface ParsedCall {
  /** qualified name of the enclosing symbol, or '<module>' for top-level calls */
  caller: string;
  calleeExpression: string;
  calleeName: string;
  calleeObject: string | null;
  line: number;
  column: number;
  argumentCount: number;
}

export interface ParsedJsx {
  /** qualified name of the enclosing component/function */
  parent: string;
  childName: string;
  line: number;
  column: number;
}

export interface ParsedFile {
  filePath: string;
  language: string | null;
  contentHash: string;
  lineCount: number;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  calls: ParsedCall[];
  jsx: ParsedJsx[];
  /** createContext(...) results and similar module-level framework facts. */
  frameworks: ParsedFrameworkFacts;
  parseErrors: string[];
}

export interface ParsedFrameworkFacts {
  /** symbols identified as React context via createContext */
  contextNames: string[];
  /** next.js route handler style exports (GET/POST/etc) */
  routeHandlerExports: string[];
  /** 'use client' / 'use server' directives */
  directives: string[];
  /** string literals passed to fetch/axios-ish calls: raw URL templates */
  httpCallTargets: HttpCallTarget[];
  /** server-side route registrations: express/fastify style `router.get('/x', h)` */
  serverRouteCalls: ServerRouteCall[];
  /** client-side navigations: router.push('/x'), navigate('/y'), redirect('/z') */
  navigationCalls: NavigationCall[];
  /** detected architecture style hints */
  usesZustand: boolean;
  usesRedux: boolean;
}

export interface ServerRouteCall {
  caller: string;
  receiver: string;
  method: string;
  path: string;
  handlerName: string | null;
  line: number;
}

export interface NavigationCall {
  caller: string;
  target: string;
  kind: 'push' | 'replace' | 'navigate' | 'redirect';
  line: number;
}

export interface HttpCallTarget {
  caller: string;
  client: 'fetch' | 'axios' | 'custom' | 'unknown';
  method: string | null;
  url: string;
  line: number;
  column: number;
}


export type FileKind =
  | 'source'
  | 'test'
  | 'config'
  | 'package-manifest'
  | 'lockfile'
  | 'documentation'
  | 'generated'
  | 'style'
  | 'asset'
  | 'other';

export interface InventoryFile {
  filePath: string;
  absPath: string;
  size: number;
  kind: FileKind;
  language: string | null;
  generated: boolean;
  generatedReason?: string;
  isTest: boolean;
}

export interface Inventory {
  files: InventoryFile[];
  skipped: number;
  total: number;
  root: string;
}

/** Classification used to turn parser symbols into graph node types. */
export function symbolKindToNodeType(sym: ParsedSymbol, filePath: string): NodeType {
  switch (sym.kind) {
    case 'component':
      return 'component';
    case 'hook':
      return 'hook';
    case 'context':
      return 'context';
    case 'store':
      return 'store';
    case 'class':
      return 'class';
    case 'interface':
      return 'interface';
    case 'type':
      return 'type';
    case 'enum':
      return 'enum';
    case 'constant':
      return 'constant';
    case 'variable':
      return 'variable';
    case 'function':
    default:
      if (isTestPath(filePath)) return 'test';
      if (isServicePath(filePath)) return 'service';
      return 'function';
  }
}

export function isTestPath(p: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)\//.test(p) || /\.(test|spec)\.[jt]sx?$/.test(p);
}

export function isServicePath(p: string): boolean {
  return /(^|\/)(services?|api|lib)\//.test(p);
}
