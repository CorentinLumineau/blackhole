import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { withTempGitRepo, runGit } from './lib/test-fixtures.ts';
import { exitCodeFromVerifyResults } from './verify.ts';
import {
  listTrackedFiles,
  findGitAttributeExemptions,
  scanBufferForControlChars,
  findControlCharViolations,
  runChecks,
} from './checks/control-char.check.ts';

// Issue #945 — closes the gap that let PR #944 ship scripts/checks/new-file-test-pairing.check.ts
// with a literal NUL byte used as a Map-key delimiter: the byte made the whole file binary,
// invisible to `gh pr diff`/GitHub's web diff, and every automated signal (tests, CI,
// `bun run verify`) stayed green. These tests reproduce that exact shape (PNG-signature-shaped
// binary fixture + NUL-corrupted `.ts` fixture, D1's "both look identical to git's own live
// binary heuristic" trap) to prove the `.gitattributes`-based exemption discriminates where
// git's own `--numstat`/`grep -I` heuristic provably cannot (see the sibling non-NUL-byte test
// below and Design Decision D1 in .blackhole/plans/issue-945.md).

const write = (repo: string, rel: string, content: Buffer | string): void => {
  fs.writeFileSync(path.join(repo, rel), content);
};

const commitAll = (repo: string, message: string): void => {
  runGit(repo, ['add', '-A']);
  runGit(repo, ['commit', '--quiet', '-m', message]);
};

// PNG-signature-shaped bytes including a NUL — the same byte class that makes a corrupted text
// file look identical to git's own live binary heuristic (D1). Used both as a legitimate,
// declared-binary asset and (undeclared) as the trap fixture below.
const PNG_LIKE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

describe('scanBufferForControlChars', () => {
  test('flags a NUL byte with its line number', () => {
    const buf = Buffer.from('const x = "a\x00b";\n', 'utf-8');
    expect(scanBufferForControlChars(buf)).toEqual([{ line: 1, byte: 0x00 }]);
  });

  test('does not flag tab, newline, or carriage return', () => {
    const buf = Buffer.from('a\tb\r\nc\n', 'utf-8');
    expect(scanBufferForControlChars(buf)).toEqual([]);
  });

  test('flags a non-NUL C0 control byte (0x01) on the correct line', () => {
    const buf = Buffer.from('line one\n\x01line two\n', 'utf-8');
    expect(scanBufferForControlChars(buf)).toEqual([{ line: 2, byte: 0x01 }]);
  });
});

describe('findControlCharViolations — PR #944 reproduction (red-before-green, V-UNFALSIFIABLE-01)', () => {
  test('a .ts file with a literal embedded NUL byte used as a Map-key delimiter is flagged', async () => {
    await withTempGitRepo('control-char-nul-', async (repo) => {
      write(repo, 'delimiter.check.ts', 'const seen = new Map<string, boolean>();\nseen.set(`a\x00b`, true);\n');
      commitAll(repo, 'add nul-delimited file');

      const violations = findControlCharViolations(repo);
      expect(violations).toEqual([{ file: 'delimiter.check.ts', line: 2, byte: 0x00 }]);

      // Ties the violation directly to the observable CLI contract: a non-empty violation
      // set is exactly what makes `bun run verify` exit 1 in CI.
      const asCheckResult = [{ id: 'V-CTRLCHAR-01', ok: violations.length === 0 }];
      expect(exitCodeFromVerifyResults(asCheckResult)).toBe(1);
    });
  });

  test('a clean text file using only tab/newline/CR is not flagged', async () => {
    await withTempGitRepo('control-char-clean-', async (repo) => {
      write(repo, 'clean.ts', 'const a = 1;\t// tab\r\nconst b = 2;\n');
      commitAll(repo, 'add clean file');

      const violations = findControlCharViolations(repo);
      expect(violations).toEqual([]);
      expect(exitCodeFromVerifyResults([{ id: 'V-CTRLCHAR-01', ok: violations.length === 0 }])).toBe(0);
    });
  });

  test('a synthetic binary asset declared `binary` in .gitattributes is exempted despite containing a NUL byte', async () => {
    await withTempGitRepo('control-char-binary-', async (repo) => {
      write(repo, 'asset.png', PNG_LIKE_BYTES);
      write(repo, '.gitattributes', 'asset.png binary\n');
      commitAll(repo, 'add binary asset');

      expect(findControlCharViolations(repo)).toEqual([]);
    });
  });

  test('D1 trap in test form: a NUL-corrupted file NOT declared binary is still caught, alongside a real declared-binary asset', async () => {
    await withTempGitRepo('control-char-trap-', async (repo) => {
      write(repo, 'asset.png', PNG_LIKE_BYTES);
      write(repo, '.gitattributes', 'asset.png binary\n');
      // Not declared binary in .gitattributes — this is the exact PR #944 shape, committed
      // right next to a legitimately exempted binary asset sharing the same distinguishing
      // byte (NUL). If the exclusion mechanism used git's live heuristic instead of
      // .gitattributes, this file would be silently swallowed exactly like asset.png.
      write(repo, 'corrupt.ts', 'const seen = new Map();\nseen.set("a\x00b", 1);\n');
      commitAll(repo, 'add trap fixture');

      expect(findControlCharViolations(repo)).toEqual([{ file: 'corrupt.ts', line: 2, byte: 0x00 }]);
    });
  });

  test("a non-NUL disallowed byte (0x01) that does not flip git's own binary classification is still caught", async () => {
    await withTempGitRepo('control-char-nonnul-', async (repo) => {
      write(repo, 'sohbyte.ts', 'const x = 1;\x01\nconst y = 2;\n');
      commitAll(repo, 'add soh byte file');

      // Proves this coverage is load-bearing, not redundant with git's own behavior: git's
      // live classifier reports this file as ordinary text (no `-\t-` binary marker).
      const numstat = spawnSync('git', ['diff', '--numstat', EMPTY_TREE_SHA, 'HEAD'], {
        cwd: repo,
        encoding: 'utf-8',
      });
      expect(numstat.stdout).not.toContain('-\t-\tsohbyte.ts');

      expect(findControlCharViolations(repo)).toEqual([{ file: 'sohbyte.ts', line: 1, byte: 0x01 }]);
    });
  });

  test('a dangling symlink among tracked files is skipped without crashing (DoS mitigation)', async () => {
    await withTempGitRepo('control-char-symlink-', async (repo) => {
      write(repo, 'clean.ts', 'const a = 1;\n');
      fs.symlinkSync('does-not-exist-target', path.join(repo, 'dangling-link'));
      commitAll(repo, 'add dangling symlink');

      expect(() => findControlCharViolations(repo)).not.toThrow();
      expect(findControlCharViolations(repo)).toEqual([]);
    });
  });
});

describe('listTrackedFiles', () => {
  test('lists tracked files relative to repoRoot', async () => {
    await withTempGitRepo('control-char-listed-', async (repo) => {
      write(repo, 'a.ts', 'a');
      write(repo, 'b.ts', 'b');
      commitAll(repo, 'add files');
      expect(listTrackedFiles(repo).sort()).toEqual(['a.ts', 'b.ts']);
    });
  });
});

describe('findGitAttributeExemptions', () => {
  test('exempts only paths whose binary attribute value is "set"', async () => {
    await withTempGitRepo('control-char-exempt-', async (repo) => {
      write(repo, 'a.ts', 'a');
      write(repo, 'b.png', 'b');
      write(repo, '.gitattributes', 'b.png binary\n');
      commitAll(repo, 'add files');
      const exempted = findGitAttributeExemptions(repo, ['a.ts', 'b.png', '.gitattributes']);
      expect(exempted).toEqual(new Set(['b.png']));
    });
  });

  test('returns an empty set for an empty path list without shelling out', () => {
    expect(findGitAttributeExemptions('/nonexistent-repo-root', [])).toEqual(new Set());
  });
});

describe('control-char runChecks() against the real tree (invariance AC)', () => {
  test('returns exactly one V-CTRLCHAR-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-CTRLCHAR-01');
  });

  test('passes clean against the live tree', () => {
    const [result] = runChecks();
    // On failure, surface which file:line carries the violation rather than a bare `false`.
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});
