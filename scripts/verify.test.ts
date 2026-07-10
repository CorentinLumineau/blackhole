import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { walkMdFilesAbs } from './verify.ts';

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-verify-vcode-test-'));

describe('walkMdFilesAbs', () => {
  test('survives a subdirectory containing an .md file without throwing EISDIR (#216)', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'top-level.md'), '# top\nV-TOP-01\n');
      fs.mkdirSync(path.join(dir, 'nested'));
      fs.writeFileSync(path.join(dir, 'nested', 'child.md'), '# nested\nV-NESTED-01\n');

      expect(() => walkMdFilesAbs(dir)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns both the top-level and nested .md files, readable without error', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'top-level.md'), '# top\nV-TOP-01\n');
      fs.mkdirSync(path.join(dir, 'nested'));
      fs.writeFileSync(path.join(dir, 'nested', 'child.md'), '# nested\nV-NESTED-01\n');

      const files = walkMdFilesAbs(dir);
      expect(files.sort()).toEqual(
        [path.join(dir, 'top-level.md'), path.join(dir, 'nested', 'child.md')].sort()
      );

      const corpus = files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
      expect(corpus).toContain('V-TOP-01');
      expect(corpus).toContain('V-NESTED-01');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ignores non-.md files and returns [] for a directory that does not exist', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'not markdown');
      expect(walkMdFilesAbs(dir)).toEqual([]);
      expect(walkMdFilesAbs(path.join(dir, 'does-not-exist'))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
