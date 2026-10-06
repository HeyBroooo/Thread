import type { GraphNode } from '@cbi/shared';
import type { AnalysisContext } from './context.js';
import { analyzeFramework } from './framework.js';
import { buildArchitectureSummary, detectConventions } from './architecture.js';
import type { AnalysisResult, UnsupportedInfo } from './types.js';

const SUPPORTED_LANGUAGES = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'json']);

function computeUnsupported(ctx: AnalysisContext): UnsupportedInfo {
  const languages = new Set<string>();
  let skipped = 0;
  let generated = 0;
  for (const f of ctx.analyzed.inventory.files) {
    if (f.generated) {
      generated++;
      continue;
    }
    if (f.kind === 'asset' || f.kind === 'style' || f.kind === 'documentation') continue;
    if (f.language && !SUPPORTED_LANGUAGES.has(f.language)) {
      languages.add(f.language);
      skipped++;
    }
  }
  let dynamic = 0;
  for (const file of ctx.analyzed.files) {
    for (const call of file.calls) {
      if (call.calleeExpression.startsWith('import(') || /\[[^\]]*\]$/.test(call.calleeExpression)) dynamic++;
    }
  }
  return {
    skippedLanguages: [...languages].sort(),
    skippedFileCount: skipped,
    generatedFileCount: generated,
    unsupportedDynamicRelationships: dynamic,
  };
}

export function analyzeGraph(ctx: AnalysisContext): AnalysisResult {
  const framework = analyzeFramework(ctx);
  const architecture = buildArchitectureSummary(ctx);
  const conventions = detectConventions(ctx);
  const unsupported = computeUnsupported(ctx);

  const nodes: GraphNode[] = [...framework.nodes];
  const edges = [...framework.edges];

  return {
    nodes,
    edges,
    apiEndpoints: framework.apiEndpoints,
    routes: framework.routes,
    architecture,
    conventions,
    unsupported,
    stats: {
      serverEndpoints: framework.apiEndpoints.filter((e) => e.kind === 'server').length,
      clientEndpoints: framework.apiEndpoints.filter((e) => e.kind === 'client').length,
      routes: framework.routes.length,
      conventions: conventions.length,
    },
  };
}
