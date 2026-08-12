import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  discoverCheckModules,
  exitCodeFromVerifyResults,
  formatVerifyResultLine,
  formatVerifySummary,
  runVerifyChecks,
  runVerifyMain,
  warnOnCheckCountMismatch,
} from './verify';
import { makeTempDir } from './lib/fs.ts';

let tempDir: string;

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
  }
});

function makeChecksDir(): string {
  tempDir = makeTempDir('verify-runner-');
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

describe('formatVerifyResultLine', () => {
  test('renders pass and fail icons with optional detail', () => {
    expect(formatVerifyResultLine({ id: 'A', ok: true })).toBe('  ✓ A');
    expect(formatVerifyResultLine({ id: 'B', ok: false, detail: 'broken' })).toBe(
      '  ✗ B — broken',
    );
  });
});

describe('formatVerifySummary', () => {
  test('counts passed checks and formats summary line', () => {
    expect(
      formatVerifySummary([
        { id: 'A', ok: true },
        { id: 'B', ok: false },
      ]),
    ).toBe('\n1/2 checks passed');
  });
});

describe('runVerifyMain', () => {
  test('returns 0 and prints header, discovered checks, and summary on happy path', async () => {
    const dir = makeChecksDir();
    writeStubCheck(
      dir,
      'a.check.ts',
      'export function runChecks() { return [{ id: "A", ok: true }]; }',
    );

    const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);

    const exitCode = await runVerifyMain({ checksDir: dir });

    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      'blackhole verify\n',
      '  ✓ A',
      '\n1/1 checks passed',
    ]);
    expect(warnSpy).toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('returns 1 when any discovered check fails', async () => {
    const dir = makeChecksDir();
    writeStubCheck(
      dir,
      'fail.check.ts',
      'export function runChecks() { return [{ id: "FAIL", ok: false, detail: "boom" }]; }',
    );

    const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);

    const exitCode = await runVerifyMain({ checksDir: dir });

    expect(exitCode).toBe(1);
    expect(logSpy.mock.calls.map((call) => call[0])).toContain('  ✗ FAIL — boom');
    expect(logSpy.mock.calls.map((call) => call[0])).toContain('\n0/1 checks passed');

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('discovers and runs multiple stub checks in sorted filename order', async () => {
    const dir = makeChecksDir();
    writeStubCheck(
      dir,
      'z.check.ts',
      'export function runChecks() { return [{ id: "Z", ok: true }]; }',
    );
    writeStubCheck(
      dir,
      'a.check.ts',
      'export function runChecks() { return [{ id: "A", ok: true }]; }',
    );

    const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);

    await runVerifyMain({ checksDir: dir });

    const resultLines = logSpy.mock.calls
      .map((call) => call[0])
      .filter((line) => typeof line === 'string' && line.startsWith('  ✓'));
    expect(resultLines).toEqual(['  ✓ A', '  ✓ Z']);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
