import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { normalizePath, DiskSourceRegistry } from '@cbi/shared';
import type { Inventory } from './types.js';

export interface AliasMapping {
  /** e.g. "@/*" */
  pattern: string;
  /** e.g. "src/*" */
  targets: string[];
  /** directory the alias is relative to (baseUrl) */
  baseDir: string;
}

export interface ProjectConfig {
  /** framework signals discovered deterministically */
  frameworks: {
    react: boolean;
    nextjs: boolean;
    vue: boolean;
    angular: boolean;
    express: boolean;
    nestjs: boolean;
    fastify: boolean;
  };
  isMonorepo: boolean;
  packages: Array<{ path: string; name: string; dependencies: Record<string, string> }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  aliases: AliasMapping[];
  moduleType: 'esm' | 'cjs' | 'unknown';
  stateLibraries: string[];
  httpLibraries: string[];
  testFrameworks: string[];
  findings: string[];
}

/** Parse JSON that may contain comments / trailing commas (tsconfig, .eslintrc). */
export function parseJsonc<T = unknown>(text: string): T | null {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // strip line comments but not `https://` inside strings
    .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(stripped) as T;
  } catch {
    return null;
  }
}

function readJson<T = unknown>(path: string, root: string): T | null {
  try {
    const content = new DiskSourceRegistry(root).getFileContent(relative(root, path));
    return content === null ? null : parseJsonc<T>(content);
  } catch {
    return null;
  }
}

const HTTP_LIBS = ['axios', 'ky', 'superagent', 'got', 'node-fetch', 'undici', 'graphql-request'];
const STATE_LIBS = ['zustand', 'redux', '@reduxjs/toolkit', 'mobx', 'jotai', 'recoil', 'valtio'];
const TEST_LIBS = ['jest', 'vitest', '@testing-library/react', 'playwright', '@playwright/test', 'cypress', 'mocha'];

export function analyzeProjectConfig(root: string, inventory: Inventory): ProjectConfig {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};
  let scripts: Record<string, string> = {};
  const findings: string[] = [];
  const packages: ProjectConfig['packages'] = [];

  const pkgPaths = inventory.files
    .filter((f) => f.kind === 'package-manifest')
    .map((f) => f.filePath);

  for (const rel of pkgPaths) {
    const abs = join(root, rel);
    const pkg = readJson<{
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      type?: string;
    }>(abs, root);
    if (!pkg) {
      findings.push(`Could not parse ${rel}`);
      continue;
    }
    Object.assign(deps, pkg.dependencies ?? {}, pkg.peerDependencies ?? {});
    Object.assign(devDeps, pkg.devDependencies ?? {});
    if (rel === 'package.json') {
      scripts = pkg.scripts ?? {};
    }
    packages.push({
      path: dirname(rel) === '.' ? '' : normalizePath(dirname(rel)),
      name: pkg.name ?? rel,
      dependencies: { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) },
    });
  }

  const all = { ...deps, ...devDeps };
  const has = (name: string) => Boolean(all[name]);

  const nextConfig = inventory.files.some(
    (f) => /(^|\/)next\.config\.(js|mjs|cjs|ts)$/.test(f.filePath) || f.filePath.startsWith('app/') || f.filePath.startsWith('pages/'),
  );

  const frameworks: ProjectConfig['frameworks'] = {
    react: has('react') || has('next'),
    nextjs: has('next') || (nextConfig && !has('react')),
    vue: has('vue'),
    angular: has('@angular/core'),
    express: has('express'),
    nestjs: has('@nestjs/core'),
    fastify: has('fastify'),
  };

  // tsconfig / jsconfig aliases
  const aliases: AliasMapping[] = [];
  for (const configName of ['tsconfig.json', 'jsconfig.json']) {
    const paths = inventory.files
      .filter((f) => f.filePath === configName)
      .map((f) => f.filePath);
    for (const rel of paths) {
      const cfg = readJson<{
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
        extends?: string;
      }>(join(root, rel), root);
      const baseUrl = cfg?.compilerOptions?.baseUrl ?? '.';
      const baseDir = normalizePath(join(dirname(rel), baseUrl));
      for (const [pattern, targets] of Object.entries(cfg?.compilerOptions?.paths ?? {})) {
        aliases.push({ pattern, targets, baseDir });
      }
      // default Next.js alias when no paths configured
      if (!cfg?.compilerOptions?.paths && (frameworks.nextjs || has('next'))) {
        aliases.push({ pattern: '@/*', targets: ['*'], baseDir: normalizePath(join(dirname(rel), 'src')) });
        aliases.push({ pattern: '@/*', targets: ['*'], baseDir: '.' });
      }
    }
  }

  const rootPkg = packages.find((p) => p.path === '') ?? packages[0];
  const moduleType: ProjectConfig['moduleType'] = rootPkg
    ? readJson<{ type?: string }>(join(root, 'package.json'), root)?.type === 'module'
      ? 'esm'
      : 'cjs'
    : 'unknown';

  return {
    frameworks,
    isMonorepo: inventory.files.some((f) => f.filePath === 'pnpm-workspace.yaml' || f.filePath === 'turbo.json') || packages.length > 1,
    packages,
    dependencies: deps,
    devDependencies: devDeps,
    scripts,
    aliases,
    moduleType,
    stateLibraries: STATE_LIBS.filter(has),
    httpLibraries: HTTP_LIBS.filter(has),
    testFrameworks: TEST_LIBS.filter(has),
    findings,
  };
}
