import type { Finding, GraphEdge, GraphNode } from '@cbi/shared';
import { redact, truncateMiddle } from '@cbi/shared';
import type { Convention } from '@cbi/analyzer';
import { generateStructured, type AIProvider } from './provider.js';
import { PR_SCHEMA_HINT, PR_REVIEW_SYSTEM_PROMPT } from './prompts.js';
import { PRFindingsSchema, type RawPRFindings } from './schemas.js';

export interface ChangedSymbolSummary {
  node: GraphNode;
  relationships: GraphEdge[];
}

export interface ImpactSummary {
  nodeId: string;
  name: string;
  nodeType: string;
  impact: 'DIRECT' | 'INDIRECT' | 'UNRELATED';
  distance: number;
  filePath: string | null;
}

export interface AiReviewInput {
  repositoryId: string;
  pullRequestNumber: number;
  title: string;
  baseSha: string | null;
  headSha: string | null;
  diff: string;
  changedFiles: string[];
  changedSymbols: ChangedSymbolSummary[];
  impact: ImpactSummary[];
  conventions: Convention[];
  deterministicFindings: Finding[];
  graphIsPartial?: boolean;
}

export interface AiReviewResult {
  findings: Array<Finding & { origin: 'ai' }>;
  summary: string;
  raw: RawPRFindings;
}

function renderContext(input: AiReviewInput, maxTokens: number): string {
  const lines: string[] = [];
  lines.push(`PULL REQUEST #${input.pullRequestNumber}: ${input.title}`);
  lines.push(`CHANGED FILES (${input.changedFiles.length}):`);
  for (const f of input.changedFiles.slice(0, 60)) lines.push(`- ${f}`);

  lines.push('');
  lines.push('CHANGED SYMBOLS AND THEIR GRAPH RELATIONSHIPS:');
  for (const { node, relationships } of input.changedSymbols.slice(0, 30)) {
    lines.push(`NODE: ${node.name} | TYPE: ${node.nodeType} | FILE: ${node.filePath ?? '?'}:${node.startLine ?? '?'}-${node.endLine ?? '?'}`);
    for (const edge of relationships.slice(0, 12)) {
      lines.push(`  RELATIONSHIP: ${edge.edgeType} (confidence ${edge.confidence.toFixed(2)}) — ${redact(edge.evidence)}`);
    }
  }

  const direct = input.impact.filter((i) => i.impact === 'DIRECT');
  const indirect = input.impact.filter((i) => i.impact === 'INDIRECT');
  lines.push('');
  lines.push(`IMPACT: ${direct.length} direct, ${indirect.length} indirect`);
  for (const i of direct.slice(0, 40)) lines.push(`  DIRECT: ${i.name} (${i.nodeType}) ${i.filePath ?? ''}`);
  for (const i of indirect.slice(0, 40)) lines.push(`  INDIRECT (distance ${i.distance}): ${i.name} (${i.nodeType}) ${i.filePath ?? ''}`);

  if (input.conventions.length > 0) {
    lines.push('');
    lines.push('ESTABLISHED PROJECT CONVENTIONS (with real examples):');
    for (const c of input.conventions) {
      lines.push(`CONVENTION: ${c.name} — ${c.description}`);
      for (const ex of c.examples.slice(0, 3)) {
        lines.push(`  EXAMPLE ${ex.filePath}:${ex.startLine}  ${redact(ex.snippet.split('\n')[0] ?? '')}`);
      }
    }
  }

  if (input.deterministicFindings.length > 0) {
    lines.push('');
    lines.push('DETERMINISTIC FINDINGS ALREADY DETECTED (strong signals):');
    for (const f of input.deterministicFindings.slice(0, 20)) {
      lines.push(`FINDING [${f.severity}/${f.category}] ${f.file}:${f.line} — ${f.title}: ${f.explanation} (confidence ${f.confidence})`);
    }
  }

  lines.push('');
  lines.push('DIFF (redacted, truncated):');
  lines.push(truncateMiddle(redact(input.diff), maxTokens * 3));

  if (input.graphIsPartial) {
    lines.push('');
    lines.push('NOTE: the repository graph is only partially indexed; be conservative about architectural claims.');
  }

  return truncateMiddle(lines.join('\n'), maxTokens * 4);
}

export async function generateAiReview(
  provider: AIProvider,
  input: AiReviewInput,
  options: { model?: string; maxTokens?: number } = {},
): Promise<AiReviewResult> {
  const maxTokens = options.maxTokens ?? 8000;
  const context = renderContext(input, maxTokens);

  const { data } = await generateStructured(
    provider,
    {
      system: PR_REVIEW_SYSTEM_PROMPT,
      context,
      user: `Review pull request #${input.pullRequestNumber} "${input.title}" against the repository graph evidence above.`,
      schema: PR_SCHEMA_HINT,
      model: options.model,
      temperature: 0.1,
      maxTokens,
    },
    { schema: PRFindingsSchema },
  );

  const findings = data.findings.map((f) => ({
    severity: f.severity as Finding['severity'],
    category: f.category,
    file: f.file,
    line: f.line,
    title: f.title,
    explanation: f.explanation,
    suggestion: f.suggestion,
    confidence: f.confidence,
    evidence: f.evidence,
    origin: 'ai' as const,
    analyzer: 'ai-review',
  }));

  return { findings, summary: data.summary ?? '', raw: data };
}
