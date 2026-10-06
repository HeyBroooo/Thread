/** Rough token estimate; good enough for context budgeting (4 chars ~= 1 token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor((maxChars - 20) / 2);
  return `${text.slice(0, half)}\n... [truncated] ...\n${text.slice(text.length - half)}`;
}

export function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Extract a 1-based inclusive line range from file content. */
export function sliceLines(content: string, startLine: number, endLine: number): string {
  const all = lines(content);
  const start = Math.max(1, startLine);
  const end = Math.min(all.length, endLine);
  if (end < start) return '';
  return all.slice(start - 1, end).join('\n');
}

export function lineCount(content: string): number {
  if (content.length === 0) return 0;
  return lines(content).length;
}

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.md': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
};

export function languageForPath(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  return LANG_BY_EXT[path.slice(dot).toLowerCase()] ?? null;
}

export function isTsJsSource(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path);
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

/** Convert a PascalCase/camelCase identifier to space-separated words. */
export function humanize(identifier: string): string {
  return identifier
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function uniqueBy<T, K>(items: T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
