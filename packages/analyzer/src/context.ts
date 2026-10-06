import type { GraphNode } from '@cbi/shared';
import type { AnalyzedRepository } from '@cbi/parser';

export interface AnalysisContext {
  repositoryId: string;
  analyzed: AnalyzedRepository;
  /** key: `${filePath}#${symbolName}` -> symbol node */
  symbolIndex: Map<string, GraphNode>;
  /** key: filePath -> file node */
  fileIndex: Map<string, GraphNode>;
}

export function symbolKey(filePath: string, name: string): string {
  return `${filePath}#${name}`;
}

export function findSymbol(ctx: AnalysisContext, filePath: string, name: string): GraphNode | null {
  return ctx.symbolIndex.get(symbolKey(filePath, name)) ?? null;
}

/**
 * Resolve the symbol a call/navigation belongs to. Nested handlers (arrows
 * inside a component or object literal) are not graph nodes, so fall back to
 * the smallest declared symbol whose line range contains the call site.
 */
export function resolveCallerSymbol(
  ctx: AnalysisContext,
  filePath: string,
  callerName: string,
  line: number,
): GraphNode | null {
  const direct = findSymbol(ctx, filePath, callerName);
  if (direct) return direct;
  const file = ctx.analyzed.byPath.get(filePath);
  if (!file) return ctx.fileIndex.get(filePath) ?? null;
  let best: GraphNode | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const sym of file.symbols) {
    if (line < sym.startLine || line > sym.endLine) continue;
    const span = sym.endLine - sym.startLine;
    if (span < bestSpan) {
      const node = findSymbol(ctx, filePath, sym.name);
      if (node) {
        best = node;
        bestSpan = span;
      }
    }
  }
  return best ?? ctx.fileIndex.get(filePath) ?? null;
}

/** Strip an origin and normalize framework/path params to `{param}` form. */
export function normalizePathTemplate(raw: string): string {
  let path = raw.trim();
  // strip query/hash
  path = path.split('?')[0]!.split('#')[0]!;
  // remove absolute origin e.g. https://api.example.com/v1/x
  const originMatch = path.match(/^[a-z]+:\/\/[^/]+(\/.*)?$/i);
  if (originMatch) path = originMatch[1] ?? '/';
  const baseUrlMatch = path.match(/^(?:process\.env\.[A-Z0-9_]+|API_URL|BASE_URL|baseUrl)\s*\+?\s*(\/.*)?$/);
  if (baseUrlMatch) path = baseUrlMatch[1] ?? '/';
  if (!path.startsWith('/')) path = '/' + path;
  path = path
    // template interpolations: ${id} / ${patient.id} -> {id} (last path of the expression)
    .replace(/\$\{([^}]*)\}/g, (_m, expr: string) => `{${paramName(expr)}}`)
    // dynamic segments: :id
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
    // next.js dynamic: [id] / [...slug] / [[...slug]]
    .replace(/\[\[?\.\.\.([A-Za-z0-9_]+)\]?\]/g, '{$1}')
    .replace(/\[([A-Za-z0-9_]+)\]/g, '{$1}');
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

/** Derive a stable parameter name from an interpolation expression. */
function paramName(expr: string): string {
  const parts = expr.trim().split(/[.\[\]]+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? 'param';
  const clean = last.replace(/[^A-Za-z0-9_]/g, '');
  return clean || 'param';
}

export function routePathFromAppFile(filePath: string): string | null {
  // app/patients/[id]/page.tsx -> /patients/{id}
  const m = filePath.match(/^app\/(.*)$/);
  if (!m) return null;
  let rest = m[1]!;
  rest = rest.replace(/\/(page|route|layout|loading|error|not-found|template)\.(tsx?|jsx?)$/i, '');
  rest = rest.replace(/\.(tsx?|jsx?)$/i, '');
  const segments = rest.split('/').filter(Boolean).filter((s) => !/^\(.*\)$/.test(s)); // route groups
  const path = '/' + segments.map((s) => s.replace(/\[\[?\.\.\.([A-Za-z0-9_]+)\]?\]/g, '{$1}').replace(/\[([A-Za-z0-9_]+)\]/g, '{$1}')).join('/');
  return path === '/' ? '/' : path.replace(/\/$/, '');
}

export function routePathFromPagesFile(filePath: string): string | null {
  const m = filePath.match(/^src\/pages\/(.*)$|^pages\/(.*)$/);
  if (!m) return null;
  let rest = (m[1] ?? m[2])!;
  rest = rest.replace(/\.(tsx?|jsx?)$/i, '');
  if (rest === 'index') return '/';
  rest = rest.replace(/\/index$/, '');
  const segments = rest.split('/').filter(Boolean).map((s) => s.replace(/^\[\.\.\.([A-Za-z0-9_]+)\]$/, '{$1}').replace(/^\[([A-Za-z0-9_]+)\]$/, '{$1}'));
  return '/' + segments.join('/');
}
