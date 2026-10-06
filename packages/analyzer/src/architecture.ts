import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sliceLines } from '@cbi/shared';
import type { AnalysisContext } from './context.js';
import type { ArchitectureSummary, Convention } from './types.js';

const AUTH_LIBS: Array<[string, string]> = [
  ['keycloak-js', 'Keycloak'],
  ['@react-keycloak/web', 'Keycloak'],
  ['next-auth', 'NextAuth'],
  ['@auth/core', 'Auth.js'],
  ['@clerk/nextjs', 'Clerk'],
  ['@clerk/clerk-react', 'Clerk'],
  ['@auth0/auth0-react', 'Auth0'],
  ['firebase', 'Firebase Auth'],
  ['passport', 'Passport'],
  ['supertokens-auth-react', 'SuperTokens'],
  ['lucia', 'Lucia'],
  ['aws-amplify', 'AWS Cognito'],
];

const PACKAGE_MANAGERS: Array<[string, string]> = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

function readFileSafe(root: string, rel: string, cache: Map<string, string>): string {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit;
  let content = '';
  try {
    content = readFileSync(join(root, rel), 'utf8');
  } catch {
    content = '';
  }
  cache.set(rel, content);
  return content;
}

export function buildArchitectureSummary(ctx: AnalysisContext): ArchitectureSummary {
  const { config, inventory, files } = ctx.analyzed;
  const frontend: string[] = [];
  const backend: string[] = [];
  const api: string[] = [];

  if (config.frameworks.react) frontend.push('React');
  if (config.frameworks.nextjs) frontend.push('Next.js');
  if (config.frameworks.vue) frontend.push('Vue');
  if (config.frameworks.angular) frontend.push('Angular');
  if (files.some((f) => f.language === 'typescript' || f.language === 'typescriptreact')) frontend.push('TypeScript');

  if (config.frameworks.express) backend.push('Express');
  if (config.frameworks.nestjs) backend.push('NestJS');
  if (config.frameworks.fastify) backend.push('Fastify');
  if (config.dependencies['hono']) backend.push('Hono');

  const state = [...new Set([
    ...config.stateLibraries.map((l) => (l === '@reduxjs/toolkit' ? 'Redux Toolkit' : l)),
    ...(files.some((f) => f.frameworks.usesZustand) ? ['Zustand'] : []),
    ...(files.some((f) => f.frameworks.usesRedux) ? ['Redux'] : []),
  ])];

  const hasClientEndpoints = files.some((f) => f.frameworks.httpCallTargets.length > 0);
  if (hasClientEndpoints) api.push('REST');
  if (config.dependencies['graphql'] || config.dependencies['@apollo/client'] || config.dependencies['graphql-request'] || config.dependencies['urql']) {
    api.push('GraphQL');
  }
  if (config.dependencies['trpc'] || config.dependencies['@trpc/server']) api.push('tRPC');

  const hasAppRouter = files.some((f) => /(^|\/)(?:src\/)?app\//.test(f.filePath));
  const hasPagesRouter = files.some((f) => /(^|\/)(?:src\/)?pages\//.test(f.filePath));
  const routing =
    config.frameworks.nextjs && hasAppRouter
      ? 'Next.js App Router'
      : hasPagesRouter
        ? 'Next.js Pages Router'
        : config.dependencies['react-router-dom'] || config.dependencies['react-router']
          ? 'React Router'
          : hasAppRouter
            ? 'Next.js App Router'
            : 'none detected';

  const authentication = AUTH_LIBS.filter(([dep]) => config.dependencies[dep] || config.devDependencies[dep]).map(
    ([, label]) => label,
  );

  const packageManager = PACKAGE_MANAGERS.find(([lock]) => inventory.files.some((f) => f.filePath === lock))?.[1] ?? null;

  const serviceDirs = new Set<string>();
  for (const f of files) {
    const m = f.filePath.match(/^(.*?(?:^|\/)(?:services?|api|lib|server)\/)/);
    if (m) serviceDirs.add(m[1]!.replace(/\/$/, ''));
  }

  return {
    frontend: [...new Set(frontend)],
    backend: [...new Set(backend)],
    state,
    api: [...new Set(api)],
    routing,
    authentication,
    testing: config.testFrameworks,
    services: [...serviceDirs].sort(),
    packageManager,
    monorepo: config.isMonorepo,
    packages: config.packages.map((p) => ({ name: p.name, path: p.path })),
  };
}

export function detectConventions(ctx: AnalysisContext): Convention[] {
  const cache = new Map<string, string>();
  const root = ctx.analyzed.root;
  const conventions: Convention[] = [];

  // 1. Shared `cn` className utility
  const cnUsers = ctx.analyzed.files.filter((f) =>
    f.imports.some((i) => i.namedImports.some((n) => n.name === 'cn')) ||
    f.calls.some((c) => c.calleeName === 'cn'),
  );
  if (cnUsers.length >= 2) {
    const examples = cnUsers.slice(0, 5).flatMap((f) => {
      const call = f.calls.find((c) => c.calleeName === 'cn');
      if (!call) return [];
      const content = readFileSafe(root, f.filePath, cache);
      return [
        {
          filePath: f.filePath,
          startLine: call.line,
          endLine: call.line,
          snippet: sliceLines(content, call.line, call.line).trim(),
          symbol: call.caller === '<module>' ? null : call.caller,
        },
      ];
    });
    if (examples.length > 0) {
      conventions.push({
        name: 'shared-classname-utility',
        description:
          'className values are composed with the shared `cn` utility rather than raw template strings.',
        examples,
        confidence: 0.9,
      });
    }
  }

  // 2. 'use client' for interactive components
  const clientComponents = ctx.analyzed.files.filter(
    (f) => f.frameworks.directives.includes('use client') && f.symbols.some((s) => s.kind === 'component'),
  );
  if (clientComponents.length >= 2) {
    conventions.push({
      name: 'use-client-directive',
      description: 'Interactive components declare a "use client" directive at the top of the file.',
      examples: clientComponents.slice(0, 5).map((f) => ({
        filePath: f.filePath,
        startLine: 1,
        endLine: 1,
        snippet: '"use client";',
        symbol: f.symbols.find((s) => s.kind === 'component')?.name ?? null,
      })),
      confidence: 0.95,
    });
  }

  // 3. HTTP access through a service layer
  const directFetchComponents = ctx.analyzed.files.filter(
    (f) => f.frameworks.httpCallTargets.length > 0 && f.symbols.some((s) => s.kind === 'component'),
  );
  const serviceFiles = ctx.analyzed.files.filter(
    (f) => /(^|\/)services?\//.test(f.filePath) && f.frameworks.httpCallTargets.length > 0,
  );
  if (serviceFiles.length > 0 && directFetchComponents.length <= serviceFiles.length) {
    conventions.push({
      name: 'service-layer-http',
      description:
        'HTTP calls are made from service modules rather than directly inside components.',
      examples: serviceFiles.slice(0, 5).flatMap((f) => {
        const call = f.frameworks.httpCallTargets[0];
        if (!call) return [];
        const content = readFileSafe(root, f.filePath, cache);
        return [
          {
            filePath: f.filePath,
            startLine: call.line,
            endLine: call.line,
            snippet: sliceLines(content, call.line, call.line).trim(),
            symbol: call.caller === '<module>' ? null : call.caller,
          },
        ];
      }),
      confidence: 0.85,
    });
  }

  // 4. Path alias imports
  const aliasImports = ctx.analyzed.files.flatMap((f) => f.imports.filter((i) => i.resolution === 'alias'));
  if (aliasImports.length >= 3) {
    const firstFile = ctx.analyzed.files.find((f) => f.imports.some((i) => i.resolution === 'alias'));
    const imp = firstFile?.imports.find((i) => i.resolution === 'alias');
    if (firstFile && imp) {
      const content = readFileSafe(root, firstFile.filePath, cache);
      conventions.push({
        name: 'path-aliases',
        description: 'Modules are imported through configured path aliases rather than deep relative paths.',
        examples: [
          {
            filePath: firstFile.filePath,
            startLine: imp.line,
            endLine: imp.line,
            snippet: sliceLines(content, imp.line, imp.line).trim(),
            symbol: null,
          },
        ],
        confidence: 0.9,
      });
    }
  }

  // 5. Zustand store convention
  const storeFiles = ctx.analyzed.files.filter((f) => f.frameworks.usesZustand);
  if (storeFiles.length > 0) {
    conventions.push({
      name: 'zustand-stores',
      description: 'Application state is defined with Zustand `create` stores.',
      examples: storeFiles.slice(0, 5).map((f) => {
        const sym = f.symbols.find((s) => s.kind === 'store');
        return {
          filePath: f.filePath,
          startLine: sym?.startLine ?? 1,
          endLine: sym?.endLine ?? 1,
          snippet: sym ? `const ${sym.name} = create(...)` : 'create(...)',
          symbol: sym?.name ?? null,
        };
      }),
      confidence: 0.9,
    });
  }

  return conventions;
}
