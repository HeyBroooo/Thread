export interface DiffFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  addedLines: number[];
  removedLines: number[];
  /** Text of each added line (no leading `+`), index-aligned with `addedLines`. */
  addedTexts: string[];
  /** Text of each removed line (no leading `-`), index-aligned with `removedLines`. */
  removedTexts: string[];
  hunkCount: number;
}

export interface ParsedDiff {
  files: DiffFile[];
  changedFiles: string[];
  /** file path -> set of new-file line numbers that were added */
  addedLineSet: Map<string, Set<number>>;
  /** file path -> set of all line numbers touched (added or context inside hunks) */
  touchedLineSet: Map<string, Set<number>>;
}

/** Parse a unified git diff (as returned by GitHub with the .diff media type). */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const files: DiffFile[] = [];
  const addedLineSet = new Map<string, Set<number>>();
  const touchedLineSet = new Map<string, Set<number>>();

  let current: DiffFile | null = null;
  let newLine = 0;
  const lines = diff.split('\n');

  for (const raw of lines) {
    if (raw.startsWith('diff --git')) {
      current = null;
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const path = normalizeDiffPath(raw.slice(4).trim());
      if (!path || path === '/dev/null') {
        if (current) current.status = 'removed';
        continue;
      }
      if (current && current.path === path && !files.includes(current)) {
        // same file block continuing
      } else {
        current = { path, status: 'modified', addedLines: [], removedLines: [], addedTexts: [], removedTexts: [], hunkCount: 0 };
        files.push(current);
      }
      addedLineSet.set(path, new Set());
      touchedLineSet.set(path, new Set());
      continue;
    }
    if (raw.startsWith('--- ')) {
      const prev = normalizeDiffPath(raw.slice(4).trim());
      if (current && prev && prev !== '/dev/null' && prev !== current.path) current.previousPath = prev;
      continue;
    }
    if (raw.startsWith('new file mode')) {
      if (current) current.status = 'added';
      continue;
    }
    if (raw.startsWith('rename from') || raw.startsWith('rename to')) {
      if (current) current.status = 'renamed';
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m && current) {
        newLine = Number(m[1]);
        current.hunkCount++;
      }
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('+')) {
      current.addedLines.push(newLine);
      current.addedTexts.push(raw.slice(1));
      addedLineSet.get(current.path)?.add(newLine);
      touchedLineSet.get(current.path)?.add(newLine);
      newLine++;
    } else if (raw.startsWith('-')) {
      current.removedLines.push(newLine);
      current.removedTexts.push(raw.slice(1));
      // removed lines do not advance the new-file counter
    } else if (raw.startsWith(' ')) {
      touchedLineSet.get(current.path)?.add(newLine);
      newLine++;
    }
  }

  return {
    files,
    changedFiles: files.map((f) => f.path),
    addedLineSet,
    touchedLineSet,
  };
}

function normalizeDiffPath(p: string): string | null {
  let path = p;
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  if (path.startsWith('a/') || path.startsWith('b/')) path = path.slice(2);
  return path.replace(/\\/g, '/');
}

/** Union of added and touched lines: the lines a finding may legitimately point at. */
export function allChangedLines(parsed: ParsedDiff): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const file of parsed.changedFiles) {
    const set = new Set<number>([...(parsed.touchedLineSet.get(file) ?? []), ...(parsed.addedLineSet.get(file) ?? [])]);
    out.set(file, set);
  }
  return out;
}

export function isLineChanged(parsed: ParsedDiff, filePath: string, line: number): boolean {
  const set = parsed.touchedLineSet.get(filePath.replace(/\\/g, '/'));
  return set ? set.has(line) : false;
}
