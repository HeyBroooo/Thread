import { execFileSync } from 'node:child_process';
import { createLogger } from '@cbi/shared';

const log = createLogger({ component: 'git' });

export interface CommitInfo {
  sha: string;
  author: string | null;
  email: string | null;
  message: string;
  committedAt: string | null;
  changedFiles: string[];
}

export interface FileHistoryEntry {
  filePath: string;
  commits: number;
  lastCommitSha: string | null;
  lastCommittedAt: string | null;
  authors: string[];
}

export interface ChangeCoupling {
  a: string;
  b: string;
  count: number;
  /** Explicitly labelled historical, not a structural dependency (doc §97). */
  kind: 'historical_coupling';
}

export interface GitAnalysis {
  available: boolean;
  headSha: string | null;
  commits: CommitInfo[];
  fileHistory: FileHistoryEntry[];
  changeCoupling: ChangeCoupling[];
  frequentlyChanged: Array<{ filePath: string; commits: number }>;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    log.debug('git.command_failed', { args: args.join(' '), message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export function isGitRepository(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

export function getHeadSha(root: string): string | null {
  return git(root, ['rev-parse', 'HEAD']);
}

/** Files changed between two revisions (used for incremental indexing, doc §22). */
export function diffFilesBetween(root: string, fromSha: string, toSha: string): string[] {
  const out = git(root, ['diff', '--name-only', `${fromSha}...${toSha}`]);
  if (!out) {
    // fall back to a two-dot diff when the merge-base comparison fails
    const fallback = git(root, ['diff', '--name-only', fromSha, toSha]);
    return fallback ? fallback.split('\n').filter(Boolean) : [];
  }
  return out.split('\n').filter(Boolean);
}

export function analyzeGitHistory(root: string, options: { maxCommits?: number } = {}): GitAnalysis {
  const maxCommits = options.maxCommits ?? 300;
  if (!isGitRepository(root)) {
    return { available: false, headSha: null, commits: [], fileHistory: [], changeCoupling: [], frequentlyChanged: [] };
  }

  const headSha = getHeadSha(root);
  const raw = git(root, ['log', `-n${maxCommits}`, '--pretty=format:__C__%H%x1f%an%x1f%ae%x1f%aI%x1f%s', '--name-only']);
  const commits: CommitInfo[] = [];
  if (raw) {
    const blocks = raw.split('__C__').filter((b) => b.trim().length > 0);
    for (const block of blocks) {
      const [headerLine, ...fileLines] = block.split('\n');
      const parts = (headerLine ?? '').split('\u001f');
      commits.push({
        sha: parts[0] ?? '',
        author: parts[1] ?? null,
        email: parts[2] ?? null,
        committedAt: parts[3] ?? null,
        message: parts[4] ?? '',
        changedFiles: fileLines.map((l) => l.trim()).filter((l) => l.length > 0),
      });
    }
  }

  const historyMap = new Map<string, FileHistoryEntry>();
  const couplingMap = new Map<string, number>();

  for (const commit of commits) {
    const uniqueFiles = [...new Set(commit.changedFiles)].slice(0, 60);
    for (const file of uniqueFiles) {
      const entry = historyMap.get(file) ?? { filePath: file, commits: 0, lastCommitSha: null, lastCommittedAt: null, authors: [] };
      entry.commits += 1;
      if (!entry.lastCommittedAt || (commit.committedAt && commit.committedAt > entry.lastCommittedAt)) {
        entry.lastCommittedAt = commit.committedAt;
        entry.lastCommitSha = commit.sha;
      }
      if (commit.author && !entry.authors.includes(commit.author)) entry.authors.push(commit.author);
      historyMap.set(file, entry);
    }
    for (let i = 0; i < uniqueFiles.length; i++) {
      for (let j = i + 1; j < uniqueFiles.length; j++) {
        const a = uniqueFiles[i]!;
        const b = uniqueFiles[j]!;
        const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
        couplingMap.set(key, (couplingMap.get(key) ?? 0) + 1);
      }
    }
  }

  const changeCoupling: ChangeCoupling[] = [...couplingMap.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300)
    .map(([key, count]) => {
      const [a, b] = key.split('\u0000');
      return { a: a!, b: b!, count, kind: 'historical_coupling' as const };
    });

  return {
    available: true,
    headSha,
    commits,
    fileHistory: [...historyMap.values()],
    changeCoupling,
    frequentlyChanged: [...historyMap.values()]
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 50)
      .map((e) => ({ filePath: e.filePath, commits: e.commits })),
  };
}
