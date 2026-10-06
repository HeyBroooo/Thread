import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import { DEFAULT_IGNORES, IgnoreMatcher, isTsJsSource, languageForPath, normalizePath } from '@cbi/shared';
import type { FileKind, Inventory, InventoryFile } from './types.js';

export interface InventoryOptions {
  include?: string[];
  exclude?: string[];
  maxFileSizeBytes?: number;
  /** Follow symlinks? default false. */
  followSymlinks?: boolean;
}

const CONFIG_BASENAMES = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'turbo.json',
  'pnpm-workspace.yaml',
  'babel.config.js',
  'babel.config.cjs',
  '.prettierrc',
  '.prettierrc.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'webpack.config.js',
  'eslint.config.js',
  'eslint.config.mjs',
  '.eslintrc.json',
  '.eslintrc.js',
]);

const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'composer.lock',
  'Cargo.lock',
  'Gemfile.lock',
]);

const GENERATED_HINTS: Array<[RegExp, string]> = [
  [/\.generated\.[jt]sx?$/, 'filename .generated'],
  [/\.g\.[jt]sx?$/, 'filename .g'],
  [/^\/?(?:generated|__generated__)\//, 'generated directory'],
  [/\.d\.ts$/, 'declaration file'],
  [/\/(?:graphql|gql)\/[^/]+\.[jt]sx?$/, 'codegen output directory'],
];

const GENERATED_HEADER = /@generated|auto-?generated|do not edit|this file was generated/i;

function classify(filePath: string, ext: string, size: number): { kind: FileKind; language: string | null; generated: boolean; generatedReason?: string; isTest: boolean } {
  const language = languageForPath(filePath);
  const base = basename(filePath);
  const isTest = /\.(test|spec)\.[jt]sx?$/.test(filePath) || /(^|\/)(__tests__|__mocks__)\//.test(filePath);

  if (LOCKFILES.has(base)) {
    return { kind: 'lockfile', language, generated: true, generatedReason: 'lockfile', isTest: false };
  }
  if (base === 'package.json' || base === 'pnpm-workspace.yaml') {
    return { kind: 'package-manifest', language, generated: false, isTest: false };
  }
  if (CONFIG_BASENAMES.has(base) || /(^|\/)\.[a-z-]+rc(\.[a-z]+)?$/.test(base)) {
    return { kind: 'config', language, generated: false, isTest: false };
  }
  if (/\.(md|mdx|txt|rst)$/i.test(filePath)) {
    return { kind: 'documentation', language, generated: false, isTest: false };
  }
  if (/\.(css|scss|sass|less)$/i.test(filePath)) {
    return { kind: 'style', language, generated: false, isTest: false };
  }
  if (isTsJsSource(filePath)) {
    for (const [re, reason] of GENERATED_HINTS) {
      if (re.test(filePath)) {
        return { kind: 'generated', language, generated: true, generatedReason: reason, isTest: false };
      }
    }
    // Skip huge bundled files
    if (size > 2_000_000) {
      return { kind: 'generated', language, generated: true, generatedReason: 'oversized bundle', isTest: false };
    }
    return { kind: isTest ? 'test' : 'source', language, generated: false, isTest };
  }
  if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|pdf|zip)$/i.test(filePath)) {
    return { kind: 'asset', language: null, generated: false, isTest: false };
  }
  return { kind: 'other', language, generated: false, isTest: false };
}

/** Match a simple glob with `**` support against a repo-relative path. */
function matchesGlob(pattern: string, path: string): boolean {
  const p = pattern.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        i++;
        if (p[i + 1] === '/') i++;
        re += '.*';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if ('.+^$(){}|\\[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$').test(path);
}

export function buildInventory(root: string, options: InventoryOptions = {}): Inventory {
  const matcher = new IgnoreMatcher(DEFAULT_IGNORES);
  for (const pattern of options.exclude ?? []) {
    matcher.add(normalizePath(pattern));
  }

  const gitignorePath = join(root, '.gitignore');
  if (existsSync(gitignorePath)) {
    matcher.add(readFileSync(gitignorePath, 'utf8'));
  }
  const cbiignorePath = join(root, '.cbiignore');
  if (existsSync(cbiignorePath)) {
    matcher.add(readFileSync(cbiignorePath, 'utf8'));
  }

  const maxSize = options.maxFileSizeBytes ?? 1_500_000;
  const files: InventoryFile[] = [];
  let skipped = 0;
  let total = 0;

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = normalizePath(relative(root, abs));
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && options.followSymlinks === true && isDirSafe(abs));

      if (matcher.ignores(rel, isDir)) {
        skipped++;
        continue;
      }

      if (isDir) {
        walk(abs);
        continue;
      }

      total++;
      let size = 0;
      try {
        size = statSync(abs).size;
      } catch {
        skipped++;
        continue;
      }

      const include = options.include;
      if (include && include.length > 0 && !include.some((g) => matchesGlob(g, rel))) {
        skipped++;
        continue;
      }

      if (size > maxSize) {
        skipped++;
        continue;
      }

      const ext = extname(entry.name).toLowerCase();
      const c = classify(rel, ext, size);
      files.push({
        filePath: rel,
        absPath: abs,
        size,
        kind: c.kind,
        language: c.language,
        generated: c.generated,
        generatedReason: c.generatedReason,
        isTest: c.isTest,
      });
    }
  };

  walk(root);

  // Detect generated headers for source files that weren't otherwise flagged.
  for (const file of files) {
    if (file.generated || file.kind !== 'source') continue;
    if (file.size > 200_000) continue;
    try {
      const head = readFileSync(file.absPath, 'utf8').slice(0, 1200);
      if (GENERATED_HEADER.test(head)) {
        file.generated = true;
        file.generatedReason = 'generated header comment';
        file.kind = 'generated';
      }
    } catch {
      /* ignore */
    }
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return { files, skipped, total, root };
}

function isDirSafe(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}
