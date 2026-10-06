import { SEVERITIES, type Finding, type GraphNode } from '@cbi/shared';

export interface FindingValidationContext {
  knownFiles: Set<string>;
  /**
   * Files the PR itself touches. A file can be part of the change without being
   * in the graph (package.json is the classic case), so a deterministic finding
   * on a changed file stays valid even when the graph does not cover it.
   */
  changedFiles?: Set<string>;
  fileLineCount: Map<string, number>;
  /** file -> lines touched by the PR (added or context-in-hunk) */
  changedLines: Map<string, Set<number>>;
  /** file -> changed symbol ranges */
  symbolRanges: Map<string, Array<{ start: number; end: number }>>;
  nodeNames: Set<string>;
  /** AI findings must point at a changed line; deterministic findings need not. */
  requireChangedLine: boolean;
  minimumConfidence: number;
  /** Maximum findings of the same category for a single file. */
  maxPerFilePerCategory?: number;
}

export interface ValidationOutcome {
  accepted: Finding[];
  rejected: Array<{ finding: Finding; reason: string }>;
}

export function buildValidationContext(input: {
  nodes: GraphNode[];
  changedLines: Map<string, Set<number>>;
  changedFiles?: Set<string>;
  changedNodes: GraphNode[];
  minimumConfidence?: number;
  requireChangedLine?: boolean;
}): FindingValidationContext {
  const knownFiles = new Set<string>();
  const fileLineCount = new Map<string, number>();
  const nodeNames = new Set<string>();
  for (const node of input.nodes) {
    if (node.filePath) {
      knownFiles.add(node.filePath);
      fileLineCount.set(node.filePath, Math.max(fileLineCount.get(node.filePath) ?? 0, node.endLine ?? 0));
    }
    nodeNames.add(node.name);
  }
  const symbolRanges = new Map<string, Array<{ start: number; end: number }>>();
  for (const node of input.changedNodes) {
    if (!node.filePath) continue;
    const list = symbolRanges.get(node.filePath) ?? [];
    list.push({ start: node.startLine ?? 1, end: node.endLine ?? node.startLine ?? 1 });
    symbolRanges.set(node.filePath, list);
  }
  return {
    knownFiles,
    changedFiles: input.changedFiles,
    fileLineCount,
    changedLines: input.changedLines,
    symbolRanges,
    nodeNames,
    requireChangedLine: input.requireChangedLine ?? true,
    minimumConfidence: input.minimumConfidence ?? 0.6,
  };
}

export function validateFinding(finding: Finding, ctx: FindingValidationContext): { ok: boolean; reason?: string } {
  const file = finding.file.replace(/\\/g, '/').replace(/^\/+/, '');

  if (!finding.title?.trim()) return { ok: false, reason: 'missing title' };
  if (!finding.explanation?.trim()) return { ok: false, reason: 'missing explanation' };
  if (!ctx.knownFiles.has(file) && !ctx.changedFiles?.has(file)) {
    return { ok: false, reason: `file not in indexed graph: ${file}` };
  }
  if (!Number.isInteger(finding.line) || finding.line < 1) return { ok: false, reason: 'invalid line number' };

  const maxLine = ctx.fileLineCount.get(file) ?? 0;
  if (maxLine > 0 && finding.line > maxLine) return { ok: false, reason: `line ${finding.line} beyond file length ${maxLine}` };

  if (!SEVERITIES.includes(finding.severity)) return { ok: false, reason: `invalid severity ${finding.severity}` };
  if (typeof finding.confidence !== 'number' || finding.confidence < 0 || finding.confidence > 1) {
    return { ok: false, reason: 'invalid confidence' };
  }
  if (finding.confidence < ctx.minimumConfidence) {
    return { ok: false, reason: `confidence ${finding.confidence} below threshold ${ctx.minimumConfidence}` };
  }

  if (ctx.requireChangedLine) {
    const changed = ctx.changedLines.get(file);
    const ranges = ctx.symbolRanges.get(file) ?? [];
    const inChangedLine = changed ? changed.has(finding.line) : false;
    const inSymbolRange = ranges.some((r) => finding.line >= r.start && finding.line <= r.end);
    if (!inChangedLine && !inSymbolRange) {
      return { ok: false, reason: `line ${finding.line} is not part of the PR changes` };
    }
  }

  return { ok: true };
}

/** Validate, threshold and de-duplicate findings (doc §40, §41). */
export function validateFindings(findings: Finding[], ctx: FindingValidationContext): ValidationOutcome {
  const accepted: Finding[] = [];
  const rejected: Array<{ finding: Finding; reason: string }> = [];
  const seen = new Set<string>();
  const perFileCategory = new Map<string, number>();
  const maxPerFileCategory = ctx.maxPerFilePerCategory ?? 3;

  const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);

  for (const finding of sorted) {
    const result = validateFinding(finding, ctx);
    if (!result.ok) {
      rejected.push({ finding, reason: result.reason ?? 'invalid' });
      continue;
    }
    const file = finding.file.replace(/\\/g, '/');
    const key = `${file}:${finding.line}:${finding.title.toLowerCase()}`;
    if (seen.has(key)) {
      rejected.push({ finding, reason: 'duplicate finding' });
      continue;
    }
    const catKey = `${file}:${finding.category}`;
    const count = perFileCategory.get(catKey) ?? 0;
    if (count >= maxPerFileCategory) {
      rejected.push({ finding, reason: `too many ${finding.category} findings for ${file}` });
      continue;
    }
    seen.add(key);
    perFileCategory.set(catKey, count + 1);
    accepted.push(finding);
  }

  return { accepted, rejected };
}
