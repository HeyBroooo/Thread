import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createLogger, DiskSourceRegistry } from '@cbi/shared';

const log = createLogger({ component: 'manifests' });

/**
 * What is actually installed in a repository's `package.json`.
 *
 * The graph only knows about *packages as nodes*, which is a very different
 * question from "what did this project install". This reads the real manifests
 * — the root one plus every workspace — so the dashboard can show the
 * dependency set, the package manager and which lockfile pins it.
 */

export interface DependencyEntry {
  name: string;
  version: string;
  /** True when the manifest declares it under devDependencies. */
  dev: boolean;
  /** Coarse role — Framework, UI & styling, Data, Testing… — for grouping. */
  category: string;
}

export interface WorkspacePackage {
  name: string;
  path: string;
  private: boolean;
  dependencies: number;
}

export interface ProjectManifest {
  /** Human label for the kind of project this is (Next.js app, Node API…). */
  projectType: string;
  /** Detected package manager and the lockfile that proves it. */
  packageManager: string | null;
  lockfile: string | null;
  /** The declared package name of the root manifest, if any. */
  name: string | null;
  /** Root scripts, so the dashboard can show how the project is run. */
  scripts: Array<{ name: string; command: string }>;
  runtime: DependencyEntry[];
  dev: DependencyEntry[];
  workspaces: WorkspacePackage[];
  /** Every project root that contributed a manifest. */
  manifests: number;
  /** True when no package.json was found at all (non-Node repository). */
  empty: boolean;
}

interface RawManifest {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  packageManager?: string;
  workspaces?: string[] | { packages?: string[] };
}

function readJson<T>(file: string, root: string): T | null {
  try {
    const content = new DiskSourceRegistry(root).getFileContent(relative(root, file));
    return content ? JSON.parse(content) as T : null;
  } catch {
    return null;
  }
}

/** Expand the workspace globs people actually use: `packages/*`, `apps/*`. */
function expandWorkspaceGlobs(root: string, patterns: string[]): string[] {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.includes('..') || isAbsolute(pattern) || pattern.includes('\\')) continue;
    const clean = pattern.replace(/\/+$/, '');
    if (!clean.includes('*')) {
      if (existsSync(resolve(root, clean, 'package.json'))) dirs.push(resolve(root, clean));
      continue;
    }
    const base = clean.slice(0, clean.indexOf('*')).replace(/\/+$/, '');
    const parent = resolve(root, base || '.');
    if (!existsSync(parent)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(parent, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = resolve(parent, entry);
      if (existsSync(resolve(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

function workspacePatterns(root: RawManifest | null, checkout: string): string[] {
  const fromField = root?.workspaces;
  if (Array.isArray(fromField)) return fromField;
  if (fromField && Array.isArray(fromField.packages)) return fromField.packages;

  // pnpm keeps its workspace globs in YAML; a line scan is enough here.
  const pnpm = resolve(checkout, 'pnpm-workspace.yaml');
  if (existsSync(pnpm)) {
    try {
      const lines = (new DiskSourceRegistry(checkout).getFileContent('pnpm-workspace.yaml') ?? '').split('\n');
      const globs: string[] = [];
      for (const line of lines) {
        const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/);
        const label = line.match(/^\s*packages\s*:/);
        if (m && m[1]) globs.push(m[1].trim());
        else if (label) continue;
      }
      if (globs.length > 0) return globs;
    } catch {
      /* fall through */
    }
  }
  return [];
}

/**
 * What a dependency is *for*, roughly. Grouping by role is what makes the
 * section read differently for a Next.js app than for a Rust CLI or a plain
 * Node package: the same list sorted by purpose instead of alphabetically.
 */
const CATEGORY_RULES: Array<[string, string[]]> = [
  ['App framework', ['next', 'react', 'react-dom', 'react-router', 'react-router-dom', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'angular', '@angular/core', 'astro', 'solid-js', 'remix', '@remix-run', 'expo', 'react-native', 'electron', 'hono', 'fastify', 'express', 'koa', '@nestjs', '@trpc', 'trpc']],
  ['UI & styling', ['tailwindcss', '@tailwindcss', 'styled-components', '@emotion', 'sass', 'less', 'postcss', 'framer-motion', 'motion', 'lucide', 'lucide-react', 'react-icons', '@radix-ui', 'antd', '@mui', 'bootstrap', 'class-variance-authority', 'clsx', 'tailwind-merge', 'shadcn', 'gsap', 'sonner', 'next-themes', 'tw-animate-css', 'cmdk', 'vaul', '@headlessui']],
  ['State & data', ['zustand', 'redux', '@reduxjs', 'jotai', 'recoil', 'mobx', '@tanstack', 'swr', '@apollo', 'urql', 'graphql', 'axios', 'ky', '@trpc/client', 'drizzle', 'prisma', '@prisma', 'mongoose', 'sequelize', 'typeorm', 'kysely', 'pg', 'mysql2', 'redis', 'ioredis', 'better-sqlite3', 'sqlite3', 'supabase', '@supabase', 'firebase']],
  ['Auth', ['@clerk', 'next-auth', '@auth', 'lucia', 'passport', 'jsonwebtoken', 'jose', 'bcrypt', 'argon2', '@kinde', 'auth0']],
  ['Charts & 3D', ['three', '@react-three', '@splinetool', 'cobe', 'd3', 'chart.js', 'react-chartjs-2', 'recharts', '@observablehq', 'victory', '@nivo']],
  ['Email', ['nodemailer', 'resend', '@sendgrid', 'postmark', 'mjml', 'emailjs', '@react-email', 'react-email-editor']],
  ['AI', ['ai', '@ai-sdk', 'openai', '@anthropic-ai', 'langchain', '@langchain', '@google/generative-ai', 'ollama', '@huggingface']],
  ['Testing', ['vitest', 'jest', '@jest', 'playwright', '@playwright', 'cypress', 'mocha', '@testing-library', 'supertest', 'happy-dom', 'jsdom']],
  ['Build & tooling', ['typescript', 'vite', 'webpack', 'rollup', 'esbuild', 'turbopack', 'turbo', 'eslint', 'eslint-config-next', 'eslint-config-prettier', 'prettier', 'tsup', 'tsx', 'nodemon', 'typescript-eslint', '@typescript-eslint', 'biome', '@biomejs', 'concurrently', 'cross-env', 'rimraf', 'dotenv', '@eslint']],
  ['Type definitions', ['@types']],
];

function categorize(name: string): string {
  // Exact matches, plus scoped-package prefixes (`@radix-ui/…`, `@types/…`).
  // Deliberately no bare `-` wildcard: it would pull `react-chartjs-2` into
  // "App framework" just because it starts with "react-".
  for (const [category, names] of CATEGORY_RULES) {
    if (names.some((p) => name === p || name.startsWith(`${p}/`))) return category;
  }
  return 'Other';
}

const LOCKFILES: Array<[string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

function detectPackageManager(checkout: string, root: RawManifest | null): { manager: string | null; lockfile: string | null } {
  const declared = root?.packageManager?.split('@')[0];
  for (const [file, manager] of LOCKFILES) {
    if (existsSync(resolve(checkout, file))) return { manager: declared ?? manager, lockfile: file };
  }
  return { manager: declared ?? null, lockfile: null };
}

/** Name the shape of the project from the dependencies it depends on. */
function detectProjectType(root: RawManifest | null, deps: Set<string>, workspaceCount: number): string {
  const has = (...names: string[]) => names.some((n) => deps.has(n));
  if (has('next')) return 'Next.js app';
  if (has('react-native', 'expo')) return 'React Native app';
  if (has('nuxt')) return 'Nuxt app';
  if (has('@angular/core')) return 'Angular app';
  if (has('vue')) return 'Vue app';
  if (has('svelte', '@sveltejs/kit')) return 'Svelte app';
  if (has('astro')) return 'Astro site';
  if (has('electron')) return 'Electron desktop app';
  if (workspaceCount > 0) return 'Monorepo';
  if (has('hono', 'fastify', 'express', 'koa', '@nestjs/core')) return 'Node API service';
  if (root?.private && deps.size === 0) return 'Private package';
  if (has('typescript')) return 'TypeScript project';
  return 'Node package';
}

export function readProjectManifest(checkoutPath: string | null | undefined): ProjectManifest {
  const empty: ProjectManifest = {
    projectType: 'Unknown',
    packageManager: null,
    lockfile: null,
    name: null,
    scripts: [],
    runtime: [],
    dev: [],
    workspaces: [],
    manifests: 0,
    empty: true,
  };
  if (!checkoutPath || !existsSync(checkoutPath)) return empty;

  const rootFile = resolve(checkoutPath, 'package.json');
  if (!existsSync(rootFile)) return empty;

  const root = readJson<RawManifest>(rootFile, checkoutPath);
  if (!root) {
    log.warn('manifests.root_unreadable', { checkoutPath });
    return empty;
  }

  const runtime: DependencyEntry[] = [];
  const dev: DependencyEntry[] = [];
  for (const [name, version] of Object.entries(root.dependencies ?? {})) runtime.push({ name, version, dev: false, category: categorize(name) });
  for (const [name, version] of Object.entries(root.peerDependencies ?? {})) runtime.push({ name, version, dev: false, category: categorize(name) });
  for (const [name, version] of Object.entries(root.optionalDependencies ?? {})) runtime.push({ name, version, dev: false, category: categorize(name) });
  for (const [name, version] of Object.entries(root.devDependencies ?? {})) dev.push({ name, version, dev: true, category: categorize(name) });

  runtime.sort((a, b) => a.name.localeCompare(b.name));
  dev.sort((a, b) => a.name.localeCompare(b.name));

  const workspaces: WorkspacePackage[] = [];
  const dirs = expandWorkspaceGlobs(checkoutPath, workspacePatterns(root, checkoutPath));
  for (const dir of dirs.slice(0, 60)) {
    const manifest = readJson<RawManifest>(resolve(dir, 'package.json'), checkoutPath);
    if (!manifest) continue;
    const rel = dir.replace(checkoutPath, '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
    workspaces.push({
      name: manifest.name ?? (rel || '.'),
      path: rel || '.',
      private: Boolean(manifest.private),
      dependencies:
        Object.keys(manifest.dependencies ?? {}).length +
        Object.keys(manifest.devDependencies ?? {}).length,
    });
  }
  workspaces.sort((a, b) => a.path.localeCompare(b.path));

  const allNames = new Set([
    ...runtime.map((d) => d.name),
    ...dev.map((d) => d.name),
  ]);
  const { manager, lockfile } = detectPackageManager(checkoutPath, root);

  return {
    projectType: detectProjectType(root, allNames, workspaces.length),
    packageManager: manager,
    lockfile,
    name: root.name ?? null,
    scripts: Object.entries(root.scripts ?? {})
      .slice(0, 12)
      .map(([name, command]) => ({ name, command })),
    runtime,
    dev,
    workspaces,
    manifests: 1 + workspaces.length,
    empty: false,
  };
}
