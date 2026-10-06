import type { Finding, GraphEdge, GraphNode } from '@cbi/shared';

export interface GraphView {
  repositoryId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CustomArchitectureRule {
  name: string;
  source: string[];
  forbiddenDependencies: string[];
}

export interface RuleConfig {
  architecture?: boolean;
  duplication?: boolean;
  dependency?: boolean;
  performance?: boolean;
  security?: boolean;
  customRules?: CustomArchitectureRule[];
  /** Minimum confidence for a finding to be surfaced. */
  minimumConfidence?: number;
}

const DB_MODULE_RE = /(^|\/)(database|db|db-client|models|prisma|migrations)\//;
const DB_PACKAGE_RE = /^(pg|mysql2?|mongoose|prisma|@prisma\/client|knex|typeorm|sequelize|drizzle-orm)$/;
const DATA_LAYER_RE = /(^|\/)(database|db|models|prisma|repositories|repository)\//;

function matchesAnyPath(globs: string[], path: string): boolean {
  return globs.some((g) => {
    const clean = g.replace(/\/\*\*$/, '/').replace(/\*+$/, '');
    return path.startsWith(clean) || path.includes(clean);
  });
}

/** Detect import cycles among file-level and symbol-level IMPORTS/DEPENDS_ON edges. */
export function detectCircularDependencies(graph: GraphView): Finding[] {
  const adj = new Map<string, string[]>();
  const relevant = new Set(['IMPORTS', 'DEPENDS_ON', 'USES']);
  for (const e of graph.edges) {
    if (!relevant.has(e.edgeType)) continue;
    const list = adj.get(e.sourceNodeId) ?? [];
    list.push(e.targetNodeId);
    adj.set(e.sourceNodeId, list);
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const findings: Finding[] = [];
  const reported = new Set<string>();
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        const idx = stack.indexOf(next);
        if (idx >= 0) {
          const cycle = stack.slice(idx);
          const key = [...cycle].sort().join('|');
          if (!reported.has(key) && cycle.length <= 12) {
            reported.add(key);
            const first = nodeById.get(cycle[0]!);
            if (first?.filePath) {
              findings.push({
                severity: 'medium',
                category: 'architecture',
                file: first.filePath,
                line: first.startLine ?? 1,
                title: 'Circular dependency detected',
                explanation: `The graph contains a dependency cycle: ${cycle
                  .map((n) => nodeById.get(n)?.name ?? n)
                  .join(' -> ')} -> ${nodeById.get(cycle[0]!)?.name ?? cycle[0]}.`,
                suggestion: 'Break the cycle by extracting shared code into a lower-level module.',
                confidence: 0.95,
                origin: 'deterministic',
                analyzer: 'circular-dependency',
              });
            }
          }
        }
      } else if (c === 0) {
        visit(next);
      }
    }
    color.set(id, 2);
    stack.pop();
  };

  for (const id of adj.keys()) {
    if ((color.get(id) ?? 0) === 0) visit(id);
  }
  return findings;
}

/** UI / component layers must not reach into the data layer directly. */
export function detectLayerViolations(graph: GraphView, config: RuleConfig): Finding[] {
  const findings: Finding[] = [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const edge of graph.edges) {
    if (edge.edgeType !== 'IMPORTS') continue;
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source?.filePath || !target?.filePath) continue;

    const sourceIsUi =
      source.nodeType === 'component' ||
      /(^|\/)(components?|ui|pages|views)\//.test(source.filePath) ||
      source.filePath.startsWith('app/') ||
      source.filePath.includes('/app/');
    const targetIsData =
      DATA_LAYER_RE.test(target.filePath) || DB_MODULE_RE.test(target.filePath) || DB_PACKAGE_RE.test(target.name);

    if (sourceIsUi && targetIsData) {
      findings.push({
        severity: 'high',
        category: 'architecture',
        file: source.filePath,
        line: edge.sourceLine ?? source.startLine ?? 1,
        title: 'UI layer imports the data layer directly',
        explanation: `${source.name} (UI) imports ${target.name} from the data layer (${target.filePath}).`,
        suggestion: 'Route data access through the service layer instead of importing the data layer directly.',
        confidence: 0.9,
        evidence: edge.evidence,
        origin: 'deterministic',
        analyzer: 'layer-violation',
      });
    }
  }

  // Custom rules: source globs cannot depend on forbidden globs.
  for (const rule of config.customRules ?? []) {
    for (const edge of graph.edges) {
      if (edge.edgeType !== 'IMPORTS' && edge.edgeType !== 'DEPENDS_ON' && edge.edgeType !== 'CALLS') continue;
      const source = nodeById.get(edge.sourceNodeId);
      const target = nodeById.get(edge.targetNodeId);
      if (!source?.filePath || !target?.filePath) continue;
      if (!matchesAnyPath(rule.source, source.filePath)) continue;
      if (!matchesAnyPath(rule.forbiddenDependencies, target.filePath)) continue;
      findings.push({
        severity: 'high',
        category: 'architecture',
        file: source.filePath,
        line: edge.sourceLine ?? source.startLine ?? 1,
        title: `Architecture rule violated: ${rule.name}`,
        explanation: `${source.name} depends on ${target.name} (${target.filePath}), which is forbidden by the "${rule.name}" rule.`,
        suggestion: 'Use the approved abstraction instead of depending on the forbidden module.',
        confidence: 0.95,
        evidence: edge.evidence,
        origin: 'deterministic',
        analyzer: 'custom-rule',
      });
    }
  }

  return findings;
}

const GENERIC_UTIL_NAMES = new Set([
  'formatDate',
  'formatCurrency',
  'formatNumber',
  'parseDate',
  'toCamelCase',
  'toKebabCase',
  'slugify',
  'debounce',
  'throttle',
  'deepClone',
  'isEmpty',
  'capitalize',
  'truncate',
  'sleep',
  'uuid',
  'getInitials',
  'cn',
  'classNames',
]);

/** Duplicate utility helpers defined in multiple files (doc §37 duplication). */
export function detectDuplicateUtilities(graph: GraphView): Finding[] {
  const byName = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (!node.filePath) continue;
    if (node.nodeType !== 'function' && node.nodeType !== 'constant' && node.nodeType !== 'variable') continue;
    if (!GENERIC_UTIL_NAMES.has(node.name)) continue;
    if (/(^|\/)(__tests__|tests?)\//.test(node.filePath)) continue;
    const list = byName.get(node.name) ?? [];
    list.push(node);
    byName.set(node.name, list);
  }

  const findings: Finding[] = [];
  for (const [name, nodes] of byName) {
    const files = new Set(nodes.map((n) => n.filePath));
    if (files.size < 2) continue;
    const primary = nodes[0]!;
    findings.push({
      severity: 'medium',
      category: 'duplication',
      file: primary.filePath!,
      line: primary.startLine ?? 1,
      title: `Duplicate helper "${name}"`,
      explanation: `A function named "${name}" is defined in ${files.size} files: ${[...files].join(', ')}.`,
      suggestion: 'Consolidate into a single shared utility to avoid divergent behaviour.',
      confidence: 0.7,
      origin: 'deterministic',
      analyzer: 'duplication',
    });
  }
  return findings;
}

export function runDeterministicRules(graph: GraphView, config: RuleConfig = {}): Finding[] {
  const min = config.minimumConfidence ?? 0.6;
  const findings: Finding[] = [];
  if (config.architecture !== false) {
    findings.push(...detectCircularDependencies(graph));
    findings.push(...detectLayerViolations(graph, config));
  }
  if (config.duplication !== false) {
    findings.push(...detectDuplicateUtilities(graph));
  }
  return findings.filter((f) => f.confidence >= min);
}
