import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { walkFilesAbs, makeTempDir, cleanupDirEntries } from './fs.ts';

// #216 regression: a subdirectory entry must never reach fs.readFileSync()/be misread as a
// file — the walker must guard isDirectory() before recursing so a nested dir never throws
// EISDIR and every file at every depth is still returned.
describe('walkFilesAbs', () => {
  test('returns [] for a directory that does not exist', () => {
    const dir = makeTempDir('fs-walk-missing');
    try {
      expect(walkFilesAbs(path.join(dir, 'does-not-exist'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns [] for an empty directory', () => {
    const dir = makeTempDir('fs-walk-empty');
    try {
      expect(walkFilesAbs(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('walks nested directories without throwing EISDIR (#216) and returns files at every depth', () => {
    const dir = makeTempDir('fs-walk-nested');
    try {
      fs.writeFileSync(path.join(dir, 'top.md'), 'top');
      fs.mkdirSync(path.join(dir, 'nested'));
      fs.writeFileSync(path.join(dir, 'nested', 'child.md'), 'child');
      fs.mkdirSync(path.join(dir, 'nested', 'deeper'));
      fs.writeFileSync(path.join(dir, 'nested', 'deeper', 'grandchild.md'), 'grandchild');

      expect(() => walkFilesAbs(dir)).not.toThrow();
      const files = walkFilesAbs(dir);
      expect(files.sort()).toEqual(
        [
          path.join(dir, 'top.md'),
          path.join(dir, 'nested', 'child.md'),
          path.join(dir, 'nested', 'deeper', 'grandchild.md'),
        ].sort()
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('includes hidden dotfiles and dotdirectories', () => {
    const dir = makeTempDir('fs-walk-hidden');
    try {
      fs.writeFileSync(path.join(dir, '.hidden-file'), 'secret');
      fs.mkdirSync(path.join(dir, '.hidden-dir'));
      fs.writeFileSync(path.join(dir, '.hidden-dir', 'inner.md'), 'inner');

      const files = walkFilesAbs(dir);
      expect(files.sort()).toEqual(
        [path.join(dir, '.hidden-file'), path.join(dir, '.hidden-dir', 'inner.md')].sort()
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('follows a symlinked file and returns its path', () => {
    const dir = makeTempDir('fs-walk-symlink-file');
    try {
      const targetPath = path.join(dir, 'real.md');
      fs.writeFileSync(targetPath, 'real content');
      fs.symlinkSync(targetPath, path.join(dir, 'link.md'));

      const files = walkFilesAbs(dir);
      expect(files.sort()).toEqual([targetPath, path.join(dir, 'link.md')].sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('follows a symlinked directory and recurses into it', () => {
    const dir = makeTempDir('fs-walk-symlink-dir');
    try {
      const realDir = path.join(dir, 'real-dir');
      fs.mkdirSync(realDir);
      fs.writeFileSync(path.join(realDir, 'inner.md'), 'inner');
      fs.symlinkSync(realDir, path.join(dir, 'link-dir'), 'dir');

      const files = walkFilesAbs(dir);
      expect(files.sort()).toEqual(
        [path.join(realDir, 'inner.md'), path.join(dir, 'link-dir', 'inner.md')].sort()
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('makeTempDir', () => {
  test('creates a real, empty directory under the OS tmpdir', () => {
    const dir = makeTempDir('fs-maketempdir');
    try {
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('two calls with the same prefix return two distinct directories', () => {
    const a = makeTempDir('fs-maketempdir-dup');
    const b = makeTempDir('fs-maketempdir-dup');
    try {
      expect(a).not.toEqual(b);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test('defaults to a generic prefix when none is supplied', () => {
    const dir = makeTempDir();
    try {
      expect(fs.existsSync(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cleanupDirEntries', () => {
  test('empties a directory containing only files, leaving the directory itself intact', () => {
    const dir = makeTempDir('fs-cleanup-files');
    try {
      fs.writeFileSync(path.join(dir, 'a.md'), 'a');
      fs.writeFileSync(path.join(dir, 'b.md'), 'b');
      cleanupDirEntries(dir);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // #226 regression: a subdirectory entry inside the directory being cleaned must not throw —
  // the cleanup must recursively remove subdirectories, not assume every entry is a plain file.
  test('handles a subdirectory entry without throwing (regression #226)', () => {
    const dir = makeTempDir('fs-cleanup-subdir');
    try {
      fs.writeFileSync(path.join(dir, 'top.md'), 'top');
      const subDir = path.join(dir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'nested.md'), 'nested');

      expect(() => cleanupDirEntries(dir)).not.toThrow();
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
