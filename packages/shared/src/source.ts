import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Source access used to attach real source snippets as evidence. Implementations
 * may read from a local checkout (DiskSourceRegistry) or from the
 * source_documents table.
 */
export interface SourceRegistry {
  getFileContent(filePath: string): string | null;
  has(filePath: string): boolean;
}

/** Reads files from a local checkout, refusing paths that escape the root. */
export class DiskSourceRegistry implements SourceRegistry {
  private cache = new Map<string, string | null>();
  private rootAbs: string;

  constructor(root: string, private maxBytes = 400_000) {
    this.rootAbs = resolve(root);
  }

  get root(): string {
    return this.rootAbs;
  }

  getFileContent(filePath: string): string | null {
    const clean = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (this.cache.has(clean)) return this.cache.get(clean)!;
    const abs = resolve(this.rootAbs, clean);
    const rel = relative(this.rootAbs, abs);
    if (rel.startsWith('..') || isAbsolute(rel) || abs.includes(`..${sep}`)) {
      this.cache.set(clean, null);
      return null;
    }
    try {
      const realRoot = realpathSync(this.rootAbs);
      const realFile = realpathSync(abs);
      const realRelative = relative(realRoot, realFile);
      if (realRelative.startsWith('..') || isAbsolute(realRelative) || !statSync(realFile).isFile() || statSync(realFile).size > this.maxBytes) return null;
      const content = readFileSync(realFile, 'utf8');
      this.cache.set(clean, content);
      return content;
    } catch {
      this.cache.set(clean, null);
      return null;
    }
  }

  has(filePath: string): boolean {
    return this.getFileContent(filePath) !== null;
  }

  clear(): void {
    this.cache.clear();
  }
}

/** In-memory registry backed by an explicit path -> content map (tests, workers). */
export class MemorySourceRegistry implements SourceRegistry {
  constructor(private files: Map<string, string>) {}
  getFileContent(filePath: string): string | null {
    return this.files.get(filePath.replace(/\\/g, '/')) ?? null;
  }
  has(filePath: string): boolean {
    return this.files.has(filePath.replace(/\\/g, '/'));
  }
}
