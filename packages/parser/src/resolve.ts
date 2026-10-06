import { dirname, join, normalize } from 'node:path';
import { normalizePath } from '@cbi/shared';
import type { AliasMapping } from './projectConfig.js';

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_SUFFIXES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

export interface ResolveResult {
  resolvedFilePath: string | null;
  resolution: 'relative' | 'alias' | 'package' | 'unresolved';
}

function tryResolve(base: string, fileSet: Set<string>): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = normalizePath(normalize(base + ext));
    if (fileSet.has(candidate)) return candidate;
  }
  for (const suffix of INDEX_SUFFIXES) {
    const candidate = normalizePath(normalize(base + suffix));
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function applyAlias(specifier: string, alias: AliasMapping): string | null {
  const star = alias.pattern.indexOf('*');
  if (star === -1) {
    if (specifier !== alias.pattern) return null;
    const target = alias.targets[0];
    return target ? normalizePath(join(alias.baseDir, target)) : null;
  }
  const prefix = alias.pattern.slice(0, star);
  const suffix = alias.pattern.slice(star + 1);
  if (!specifier.startsWith(prefix)) return null;
  if (suffix && !specifier.endsWith(suffix)) return null;
  const remainder = specifier.slice(prefix.length, suffix ? specifier.length - suffix.length : undefined);
  const target = alias.targets[0] ?? '*';
  const substituted = target.includes('*') ? target.replace('*', remainder) : join(target, remainder);
  return normalizePath(join(alias.baseDir, substituted));
}

export function resolveSpecifier(
  specifier: string,
  fromFilePath: string,
  fileSet: Set<string>,
  aliases: AliasMapping[],
): ResolveResult {
  if (specifier.startsWith('.')) {
    const base = join(dirname(fromFilePath), specifier);
    const resolved = tryResolve(base, fileSet);
    return resolved
      ? { resolvedFilePath: resolved, resolution: 'relative' }
      : { resolvedFilePath: null, resolution: 'relative' };
  }

  for (const alias of aliases) {
    const applied = applyAlias(specifier, alias);
    if (!applied) continue;
    const resolved = tryResolve(applied, fileSet);
    if (resolved) return { resolvedFilePath: resolved, resolution: 'alias' };
  }

  // bare specifier: package (never index vendored dependency source)
  return { resolvedFilePath: null, resolution: 'package' };
}
