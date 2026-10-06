import type { Finding, SourceRegistry } from '@cbi/shared';
import { sliceLines } from '@cbi/shared';
import type { ParsedDiff } from './diff.js';

/** Secret shapes scanned in *added* lines only. Values are always masked. */
const SECRET_PATTERNS: Array<{ re: RegExp; label: string; severity: Finding['severity'] }> = [
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/, label: 'provider API key', severity: 'critical' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, label: 'GitHub token', severity: 'critical' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/, label: 'GitHub fine-grained token', severity: 'critical' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id', severity: 'critical' },
  { re: /\bAIza[0-9A-Za-z_-]{30,}\b/, label: 'Google API key', severity: 'critical' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: 'Slack token', severity: 'high' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key', severity: 'critical' },
  {
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    label: 'hardcoded credential',
    severity: 'high',
  },
];

export function detectSecretsInDiff(parsed: ParsedDiff, sources: SourceRegistry): Finding[] {
  const findings: Finding[] = [];
  for (const file of parsed.files) {
    const added = parsed.addedLineSet.get(file.path);
    if (!added || added.size === 0) continue;
    const content = sources.getFileContent(file.path);
    if (!content) continue;
    for (const line of added) {
      const text = sliceLines(content, line, line);
      if (!text) continue;
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.re.test(text)) {
          findings.push({
            severity: pattern.severity,
            category: 'security',
            file: file.path,
            line,
            title: `Possible hardcoded ${pattern.label}`,
            explanation:
              'A value that looks like a secret was added in this change. Secrets committed to source can leak through history even after removal.',
            suggestion: 'Move the value into environment configuration or a secret manager and rotate it.',
            confidence: 0.85,
            evidence: 'Added line matches a known secret pattern (value withheld).',
            origin: 'deterministic',
            analyzer: 'security',
          });
          break;
        }
      }
    }
  }
  return findings;
}

const DEP_LINE_RE = /^\s*"([^"]+)"\s*:\s*"(?:[~^]?[0-9]|\*|latest|workspace:|file:)/;

/** New runtime dependencies declared in package.json changes (doc §37 dependencies). */
export function detectDependencyChanges(parsed: ParsedDiff, sources: SourceRegistry): Finding[] {
  const findings: Finding[] = [];
  for (const file of parsed.files) {
    if (!/(^|\/)package\.json$/.test(file.path)) continue;
    const content = sources.getFileContent(file.path);
    if (!content) continue;
    const added = parsed.addedLineSet.get(file.path);
    if (!added) continue;
    // A replaced version line is an edit of an existing dependency, not a new one.
    const alreadyPresent = new Set<string>();
    for (const text of file.removedTexts) {
      const previous = text.match(DEP_LINE_RE);
      if (previous?.[1]) alreadyPresent.add(previous[1]);
    }
    for (const line of added) {
      const text = sliceLines(content, line, line);
      const m = text.match(DEP_LINE_RE);
      if (!m) continue;
      const name = m[1]!;
      if (alreadyPresent.has(name)) continue;
      if (['name', 'version', 'private', 'type', 'main', 'module', 'types', 'description', 'license', 'author', 'scripts', 'engines', 'packageManager'].includes(name)) {
        continue;
      }
      findings.push({
        severity: 'low',
        category: 'dependency',
        file: file.path,
        line,
        title: `New dependency added: ${name}`,
        explanation: `The change adds a dependency on "${name}". New dependencies expand the supply-chain and bundle surface and should be intentional.`,
        suggestion: 'Confirm the dependency is necessary and compatible with the project’s existing libraries.',
        confidence: 0.9,
        evidence: text.trim(),
        origin: 'deterministic',
        analyzer: 'dependency',
      });
    }
  }
  return findings;
}

/** useEffect without a dependency array is a common source of repeated work. */
export function detectPerformanceHeuristics(parsed: ParsedDiff, sources: SourceRegistry): Finding[] {
  const findings: Finding[] = [];
  for (const file of parsed.files) {
    const added = parsed.addedLineSet.get(file.path);
    if (!added || added.size === 0) continue;
    if (!/\.(tsx?|jsx?)$/.test(file.path)) continue;
    const content = sources.getFileContent(file.path);
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    for (const line of added) {
      const text = lines[line - 1] ?? '';
      if (!/useEffect\s*\(/.test(text)) continue;
      const window = lines.slice(line - 1, line + 8).join('\n');
      const hasDeps = /\]\s*\)/.test(window) || /,\s*\[\s*\]\s*\)/.test(window);
      if (hasDeps) continue;
      findings.push({
        severity: 'low',
        category: 'performance',
        file: file.path,
        line,
        title: 'useEffect without a dependency array',
        explanation:
          'This effect runs after every render. Without a dependency array it can trigger repeated work or update loops.',
        suggestion: 'Add a dependency array (or an empty array for run-once effects) unless the repeated run is intentional.',
        confidence: 0.6,
        evidence: text.trim(),
        origin: 'deterministic',
        analyzer: 'performance',
      });
    }
  }
  return findings;
}

export function runDiffAnalyzers(
  parsed: ParsedDiff,
  sources: SourceRegistry,
  config: { security?: boolean; dependency?: boolean; performance?: boolean } = {},
): Finding[] {
  const findings: Finding[] = [];
  if (config.security !== false) findings.push(...detectSecretsInDiff(parsed, sources));
  if (config.dependency !== false) findings.push(...detectDependencyChanges(parsed, sources));
  if (config.performance !== false) findings.push(...detectPerformanceHeuristics(parsed, sources));
  return findings;
}

// ------------------------------------------------------------------ version bumps

/** `"name": "version",` inside a package.json hunk. */
const DEP_ENTRY_RE = /^\s*"((?:\\.|[^"\\])*)"\s*:\s*"((?:\\.|[^"\\])*)"\s*,?\s*$/;

/** package.json keys that are not dependency versions. */
const NON_DEPENDENCY_KEYS = new Set([
  'name',
  'version',
  'private',
  'type',
  'main',
  'module',
  'types',
  'typings',
  'exports',
  'imports',
  'bin',
  'files',
  'description',
  'license',
  'author',
  'homepage',
  'repository',
  'bugs',
  'keywords',
  'scripts',
  'engines',
  'packageManager',
  'sideEffects',
  'workspaces',
  'resolutions',
  'overrides',
  'publishConfig',
]);

interface DepEntry {
  value: string;
  /** Index into the file's added/removed line arrays. */
  index: number;
}

function collectDepEntries(texts: string[]): Map<string, DepEntry> {
  const out = new Map<string, DepEntry>();
  texts.forEach((text, index) => {
    const m = text.match(DEP_ENTRY_RE);
    if (!m) return;
    const name = m[1];
    const value = m[2];
    if (!name || value === undefined || NON_DEPENDENCY_KEYS.has(name)) return;
    out.set(name, { value, index });
  });
  return out;
}

/** `^19.0.0` → 19.0.0, `60` → 60.0.0, `workspace:*` → null. */
function parseVersion(raw: string): { major: number; minor: number; patch: number } | null {
  const cleaned = raw.trim().replace(/^[\^~><=\s]*v?/, '');
  const m = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] ? Number(m[2]) : 0, patch: m[3] ? Number(m[3]) : 0 };
}

type PublishState = 'published' | 'missing' | 'unknown';

const npmStatusCache = new Map<string, Promise<PublishState>>();

/**
 * Asks the npm registry whether a concrete version exists. A version that is
 * not published can never be installed, which makes such a PR a hard blocker.
 */
function npmVersionStatus(name: string, range: string): Promise<PublishState> {
  const target = range.trim().replace(/^[\^~]/, '');
  if (!/^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/.test(target)) return Promise.resolve('unknown');
  const key = `${name}@${target}`;
  const cached = npmStatusCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<PublishState> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}/${encodeURIComponent(target)}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'codebase-intelligence' },
      });
      clearTimeout(timer);
      if (res.status === 200) return 'published';
      if (res.status === 404) return 'missing';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  })();
  npmStatusCache.set(key, promise);
  return promise;
}

async function assessVersionChange(
  name: string,
  oldRange: string,
  newRange: string,
  file: string,
  line: number,
): Promise<Finding | null> {
  const before = parseVersion(oldRange);
  const after = parseVersion(newRange);
  const evidence = `"${name}": "${newRange}" (was "${oldRange}")`;

  if (!after || !before) {
    return {
      severity: 'medium',
      category: 'dependency',
      file,
      line,
      title: `Dependency "${name}" moved to an unpinned range`,
      explanation:
        `The version range for "${name}" changed from "${oldRange}" to "${newRange}". ` +
        'Unpinned ranges (git URLs, `workspace:*`, `latest`) resolve differently on every install, so builds are not reproducible.',
      suggestion: `Pin "${name}" to an exact published version (for example the current latest release).`,
      confidence: 0.7,
      evidence,
      origin: 'deterministic',
      analyzer: 'dependency-version',
    };
  }

  if (after.major === before.major) {
    const downgrade = after.minor < before.minor || (after.minor === before.minor && after.patch < before.patch);
    if (!downgrade) return null; // routine minor/patch bump
    return {
      severity: 'medium',
      category: 'dependency',
      file,
      line,
      title: `Dependency downgrade: ${name} ${oldRange} → ${newRange}`,
      explanation:
        `"${name}" moved backwards from "${oldRange}" to "${newRange}". Downgrades reintroduce bugs already fixed in the newer release ` +
        'and can silently change behaviour for anything that relied on the newer API.',
      suggestion: `Keep "${name}" at or above "${oldRange}" unless the downgrade is deliberate and documented.`,
      confidence: 0.75,
      evidence,
      origin: 'deterministic',
      analyzer: 'dependency-version',
    };
  }

  const status = await npmVersionStatus(name, newRange);
  if (status === 'missing') {
    return {
      severity: 'high',
      category: 'dependency',
      file,
      line,
      title: `${name} ${newRange} does not exist on npm`,
      explanation:
        `The change moves "${name}" from "${oldRange}" to "${newRange}", but the npm registry has no such version ` +
        '(registry.npmjs.org returned 404). `npm install` / `npm ci` will fail, so this PR cannot build or deploy.',
      suggestion: `Use a published release of "${name}" (the latest published major is the safe choice) or publish the intended version first.`,
      confidence: 0.95,
      evidence,
      origin: 'deterministic',
      analyzer: 'dependency-version',
    };
  }

  const direction = after.major > before.major ? 'Major dependency bump' : 'Dependency downgrade';
  return {
    severity: 'medium',
    category: 'dependency',
    file,
    line,
    title: `${direction}: ${name} ${oldRange} → ${newRange}`,
    explanation:
      `"${name}" jumps from major ${before.major} to major ${after.major}. Major releases are allowed to break APIs, ` +
      (status === 'published'
        ? 'so every module importing this package must be checked for removed or changed exports.'
        : 'and this version could not be confirmed against the npm registry, so it may not be installable either.') +
      ' Verify the release notes and the dependents before merging.',
    suggestion: `Review the ${name} changelog between ${oldRange} and ${newRange} and re-run the test suite.`,
    confidence: status === 'published' ? 0.8 : 0.7,
    evidence,
    origin: 'deterministic',
    analyzer: 'dependency-version',
  };
}

/**
 * Compares the removed and added `package.json` lines of a PR so a version
 * bump of an *existing* dependency is caught — `detectDependencyChanges` only
 * sees brand-new entries, and reading the checkout would show the old value.
 */
export async function detectVersionBumps(parsed: ParsedDiff): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const file of parsed.files) {
    if (!/(^|\/)package\.json$/.test(file.path)) continue;
    const previous = collectDepEntries(file.removedTexts);
    const next = collectDepEntries(file.addedTexts);
    for (const [name, entry] of next) {
      const before = previous.get(name);
      if (!before || before.value === entry.value) continue;
      const line = file.addedLines[entry.index];
      if (!line) continue;
      const finding = await assessVersionChange(name, before.value, entry.value, file.path, line);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}
