import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { makeTempDir } from './lib/fs.ts';

const SCRIPT = path.join(import.meta.dir, 'trunk-red.ts');
const dir = makeTempDir('trunk-red-cli');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (args: string[]) => {
  const res = Bun.spawnSync(['bun', 'run', SCRIPT, ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { code: res.exitCode, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
};

const writeInput = (name: string, body: unknown): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
};

const lintFail = { check: 'lint', fingerprint: 'abc123', failingPaths: ['src/shared.ts'] };

describe('trunk-red CLI', () => {
  test('two PRs failing identically outside their own diffs: prints trunk-red and exits 1', () => {
    const file = writeInput('red.json', [
      { pr: 10, failingChecks: [lintFail], touchedFiles: ['src/a.ts'] },
      { pr: 11, failingChecks: [lintFail], touchedFiles: ['src/b.ts'] },
    ]);
    const { code, stdout } = run(['--prs', file]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      classification: 'trunk-red',
      groups: [{ check: 'lint', fingerprint: 'abc123', prs: [10, 11] }],
    });
  });

  test('one PR owns the failing path: prints per-pr and exits 0', () => {
    const file = writeInput('own.json', [
      { pr: 10, failingChecks: [lintFail], touchedFiles: ['src/shared.ts'] },
      { pr: 11, failingChecks: [lintFail], touchedFiles: ['src/b.ts'] },
    ]);
    const { code, stdout } = run(['--prs', file]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).classification).toBe('per-pr');
  });

  test('malformed entry (missing touchedFiles) is refused with exit 2, never classified', () => {
    const file = writeInput('bad.json', [{ pr: 10, failingChecks: [lintFail] }]);
    const { code, stdout, stderr } = run(['--prs', file]);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('touchedFiles');
  });

  test('non-JSON input and a missing --prs flag both exit 2', () => {
    expect(run(['--prs', writeInput('junk.json', '{not json')]).code).toBe(2);
    expect(run([]).code).toBe(2);
  });
});
