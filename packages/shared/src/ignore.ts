/**
 * A pragmatic .gitignore matcher (doc §9 Stage 2).
 *
 * Implements the common subset: comments, negation (!), directory-only
 * patterns (trailing /), anchoring (leading /), `**`, `*`, `?`, and
 * character classes. Not every git edge case is covered, but it correctly
 * handles real-world ignore files well enough for file discovery.
 */

interface Rule {
  negated: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

function globToRegex(pattern: string): RegExp {
  let p = pattern;
  let anchored = false;
  if (p.startsWith('/')) {
    anchored = true;
    p = p.slice(1);
  }
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**` crosses directory boundaries
        i++;
        if (p[i + 1] === '/') i++;
        re += '.*';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const close = p.indexOf(']', i);
      if (close > i) {
        re += p.slice(i, close + 1);
        i = close;
      } else {
        re += '\\[';
      }
    } else if ('.+^$(){}|\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }

  // A pattern without a slash matches at any depth; with a slash it is anchored.
  const hasSlash = p.includes('/');
  const prefix = anchored || hasSlash ? '^' : '(^|.*/)';
  const suffix = dirOnly ? '(/.*)?$' : '(/.*)?$';
  return new RegExp(prefix + re + suffix);
}

export class IgnoreMatcher {
  private rules: Rule[] = [];

  constructor(patterns: string[] = []) {
    for (const raw of patterns) {
      this.add(raw);
    }
  }

  add(rawLine: string): void {
    let line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    // trailing spaces are ignored unless escaped
    line = line.replace(/(?<!\\)\s+$/, '');
    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }
    if (!line) return;
    const dirOnly = line.endsWith('/');
    this.rules.push({ negated, dirOnly, regex: globToRegex(line) });
  }

  /** Returns true if the path should be ignored. */
  ignores(relPath: string, isDir = false): boolean {
    const path = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) {
        // Directory-only rules still ignore files *inside* that directory.
        const asDir = path + '/';
        if (!rule.regex.test(asDir)) continue;
      } else if (!rule.regex.test(path)) {
        continue;
      }
      ignored = !rule.negated;
    }
    return ignored;
  }

  get size(): number {
    return this.rules.length;
  }
}

export const DEFAULT_IGNORES = [
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.turbo/',
  '.git/',
  'coverage/',
  '.cache/',
  'vendor/',
  'tmp/',
  '.DS_Store',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];
