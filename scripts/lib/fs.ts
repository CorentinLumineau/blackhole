import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ADR-007 R6 — the one shared tree-walker + fixture kit. build.ts, verify checks, tree-shape
// tests, and bun:test fixtures across scripts/ migrate onto these three primitives instead of
// each defining its own recursive walk / temp-dir / cleanup loop (V-INT-02).

// Recursive, directory-safe file walk rooted at an absolute directory. Guards each entry with
// isDirectory() (following symlinks via statSync so a symlinked directory is recursed into and
// a symlinked file is returned like any other file) before recursing, so a subdirectory never
// reaches a file-read call site and triggers EISDIR (#216). Returns [] for a directory that
// does not exist. A dangling symlink (target does not exist) is skipped rather than stat'ed —
// fs.statSync() follows the link and throws ENOENT synchronously for an unresolvable target, and
// no caller catches it, so an unresolvable link is treated as neither dir nor file (#274).
export const walkFilesAbs = (absDir: string): string[] => {
  if (!fs.existsSync(absDir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isSymbolicLink() && !fs.existsSync(full)) {
      console.error(`walkFilesAbs: skipping broken symlink ${full}`);
      continue;
    }
    const isDir = entry.isSymbolicLink() ? fs.statSync(full).isDirectory() : entry.isDirectory();
    if (isDir) out.push(...walkFilesAbs(full));
    else out.push(full);
  }
  return out;
};

// Shared bun:test fixture helper: creates a fresh, empty temp directory under the OS tmpdir.
// `prefix` is cosmetic (helps a human spot a leaked fixture dir by name) and defaults to a
// generic prefix when a caller doesn't need a distinguishing name.
export const makeTempDir = (prefix = 'blackhole-test'): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));

// Directory-safe empty-out: removes every entry directly under `dir` (files and
// subdirectories alike) without removing `dir` itself. Generalizes the inline cleanup loop
// that assumed every entry was a plain file and threw on a subdirectory (#226).
export const cleanupDirEntries = (dir: string): void => {
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
};
