import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath, uniqueBy } from '@cbi/shared';
import { buildInventory, type InventoryOptions } from './inventory.js';
import { analyzeProjectConfig, type ProjectConfig } from './projectConfig.js';
import { parseFileContent } from './parseFile.js';
import { resolveSpecifier } from './resolve.js';
import { PARSER_VERSION, GRAPH_SCHEMA_VERSION, type Inventory, type ParsedFile } from './types.js';

export interface AnalyzeOptions extends InventoryOptions {
  /** Only parse these repo-relative paths (incremental indexing). */
  only?: string[];
  /** Include generated files in the graph. Default false (doc §132). */
  includeGenerated?: boolean;
  maxFiles?: number;
  onProgress?: (info: { processed: number; total: number; filePath: string }) => void;
}

export interface AnalyzeStats {
  filesParsed: number;
  filesSkipped: number;
  symbols: number;
  imports: number;
  unresolvedImports: number;
  calls: number;
  jsxEdges: number;
  httpTargets: number;
  parseErrors: number;
}

export interface AnalyzedRepository {
  root: string;
  inventory: Inventory;
  config: ProjectConfig;
  files: ParsedFile[];
  byPath: Map<string, ParsedFile>;
  aliases: ProjectConfig['aliases'];
  stats: AnalyzeStats;
  parserVersion: string;
  graphSchemaVersion: number;
}

function shouldParse(kind: string, generated: boolean, includeGenerated: boolean): boolean {
  if (!includeGenerated && generated) return false;
  return kind === 'source' || kind === 'test' || (includeGenerated && kind === 'generated');
}

export function analyzeRepository(root: string, options: AnalyzeOptions = {}): AnalyzedRepository {
  const inventory = buildInventory(root, options);
  const config = analyzeProjectConfig(root, inventory);

  const candidates = inventory.files.filter((f) => shouldParse(f.kind, f.generated, options.includeGenerated ?? false));
  const onlySet = options.only ? new Set(options.only.map(normalizePath)) : null;
  const selected = onlySet ? candidates.filter((f) => onlySet.has(f.filePath)) : candidates;
  const limited = options.maxFiles ? selected.slice(0, options.maxFiles) : selected;

  const fileSet = new Set(inventory.files.map((f) => f.filePath));
  const files: ParsedFile[] = [];
  const stats: AnalyzeStats = {
    filesParsed: 0,
    filesSkipped: inventory.skipped,
    symbols: 0,
    imports: 0,
    unresolvedImports: 0,
    calls: 0,
    jsxEdges: 0,
    httpTargets: 0,
    parseErrors: 0,
  };

  let processed = 0;
  for (const file of limited) {
    processed++;
    options.onProgress?.({ processed, total: limited.length, filePath: file.filePath });
    let content: string;
    try {
      content = readFileSync(join(root, file.filePath), 'utf8');
    } catch {
      continue;
    }
    let parsed: ParsedFile;
    try {
      parsed = parseFileContent(file.filePath, content);
    } catch (e) {
      stats.parseErrors++;
      continue;
    }

    for (const imp of parsed.imports) {
      const r = resolveSpecifier(imp.moduleSpecifier, parsed.filePath, fileSet, config.aliases);
      imp.resolvedFilePath = r.resolvedFilePath;
      imp.resolution = r.resolution;
      if (r.resolution === 'unresolved' || (r.resolution === 'relative' && !r.resolvedFilePath)) {
        stats.unresolvedImports++;
      }
    }

    files.push(parsed);
    stats.filesParsed++;
    stats.symbols += parsed.symbols.length;
    stats.imports += parsed.imports.length;
    stats.calls += parsed.calls.length;
    stats.jsxEdges += parsed.jsx.length;
    stats.httpTargets += parsed.frameworks.httpCallTargets.length;
    stats.parseErrors += parsed.parseErrors.length;
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath));

  return {
    root,
    inventory,
    config,
    files,
    byPath: new Map(files.map((f) => [f.filePath, f])),
    aliases: config.aliases,
    stats,
    parserVersion: PARSER_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
  };
}

/** Re-parse a single file within the context of a full inventory. */
export function reanalyzeFiles(root: string, analyzed: AnalyzedRepository, paths: string[]): ParsedFile[] {
  const fileSet = new Set(analyzed.inventory.files.map((f) => f.filePath));
  const out: ParsedFile[] = [];
  for (const rel of uniqueBy(paths.map(normalizePath), (p) => p)) {
    try {
      const content = readFileSync(join(root, rel), 'utf8');
      const parsed = parseFileContent(rel, content);
      for (const imp of parsed.imports) {
        const r = resolveSpecifier(imp.moduleSpecifier, parsed.filePath, fileSet, analyzed.aliases);
        imp.resolvedFilePath = r.resolvedFilePath;
        imp.resolution = r.resolution;
      }
      out.push(parsed);
    } catch {
      /* deleted or unreadable */
    }
  }
  return out;
}
