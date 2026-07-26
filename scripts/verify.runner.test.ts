import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverCheckModules,
  exitCodeFromVerifyResults,
  runVerifyChecks,
  warnOnCheckCountMismatch,
} from './verify';

let tempDir: string;

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
  }
});

function makeChecksDir(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-runner-'));
  return tempDir;
}

function writeStubCheck(dir: string, basename: string, body: string): void {
  fs.writeFileSync(path.join(dir, basename), body);
}

describe('discoverCheckModules', () => {
  test('returns lexicographically sorted *.check.ts basenames and ignores other files', () => {
    const dir = makeChecksDir();
    writeStubCheck(dir, 'b.check.ts', 'export function runChecks() { return []; }');
    writeStubCheck(dir, 'a.check.ts', 'export function runChecks() { return []; }');
    fs.writeFileSync(path.join(dir, 'readme.md'), '# ignore me');

    expect(discoverCheckModules(dir)).toEqual(['a.check.ts', 'b.check.ts']);
  });
});

describe('runVerifyChecks', () => {
  test('concatenates runChecks() outputs in sorted filename order', async () => {
    const dir = makeChecksDir();
    writeStubCheck(
      dir,
      'b.check.ts',
      'export function runChecks() { return [{ id: "B", ok: true }]; }',
    );
    writeStubCheck(
      dir,
      'a.check.ts',
      'export function runChecks() { return [{ id: "A", ok: true }]; }',
    );

    const results = await runVerifyChecks({ checksDir: dir });
    expect(results).toEqual([
      { id: 'A', ok: true },
      { id: 'B', ok: true },
    ]);
  });

  test('throws when a stub module lacks runChecks export', async () => {
    const dir = makeChecksDir();
    writeStubCheck(dir, 'broken.check.ts', 'export const value = 1;');

    await expect(runVerifyChecks({ checksDir: dir })).rejects.toThrow(
      'scripts/checks/broken.check.ts: missing runChecks() export',
    );
  });
});

describe('exitCodeFromVerifyResults', () => {
  test('returns 0 when all results are ok', () => {
    expect(
      exitCodeFromVerifyResults([
        { id: 'A', ok: true },
        { id: 'B', ok: true },
      ]),
    ).toBe(0);
  });

  test('returns 1 when any result is not ok', () => {
    expect(
      exitCodeFromVerifyResults([
        { id: 'A', ok: true },
        { id: 'B', ok: false, detail: 'failed' },
      ]),
    ).toBe(1);
  });
});

describe('warnOnCheckCountMismatch', () => {
  test('warns with expected and actual counts when they differ', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);

    warnOnCheckCountMismatch([{ id: 'A', ok: true }], 2);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('2');
    expect(warnSpy.mock.calls[0]?.[0]).toContain('1');

    warnSpy.mockRestore();
  });
});
