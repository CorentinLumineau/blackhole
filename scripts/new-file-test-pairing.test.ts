import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';

// The CLI wrapping new-file-test-pairing.check.ts's findUnpairedNewSourceFiles against real
// file-list input on disk (mirrors plan-quality-gate.test.ts's argv/file-IO split).

const scriptPath = path.join(path.resolve(import.meta.dirname), 'new-file-test-pairing.ts');

const run = (args: string[]) =>
  Bun.spawn(['bun', 'run', scriptPath, ...args], { stdout: 'pipe', stderr: 'pipe' });

describe('new-file-test-pairing CLI — argv parsing', () => {
  test('missing --added-files exits 2 with usage on stderr', async () => {
    const proc = run([]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('missing --touched-files exits 2 with usage on stderr', async () => {
    const proc = run(['--added-files', '/dev/null']);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('missing --base-tree-files exits 2 with usage on stderr', async () => {
    const proc = run(['--added-files', '/dev/null', '--touched-files', '/dev/null']);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });
});

describe('new-file-test-pairing CLI — end to end (Task 2 fixture shapes)', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir('new-file-test-pairing-cli');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, lines: string[]) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.join('\n'));
    return p;
  };

  test('#805 shape: exit 0, non-empty detail for the unpaired new file', async () => {
    const baseTreeFile = write('base-tree.txt', [
      'dirX/foo1.ts',
      'dirX/tests/foo1.test.ts',
      'dirX/foo2.ts',
      'dirX/tests/foo2.test.ts',
    ]);
    const addedFile = write('added.txt', ['dirX/bar.ts']);
    const touchedFile = write('touched.txt', ['dirX/bar.ts']);

    const proc = run([
      '--added-files', addedFile,
      '--touched-files', touchedFile,
      '--base-tree-files', baseTreeFile,
    ]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('dirX/bar.ts');
  });

  test('has-test shape: exit 0, empty detail when the derived test path was also added', async () => {
    const baseTreeFile = write('base-tree.txt', [
      'dirX/foo1.ts',
      'dirX/tests/foo1.test.ts',
      'dirX/foo2.ts',
      'dirX/tests/foo2.test.ts',
    ]);
    const addedFile = write('added.txt', ['dirX/bar.ts']);
    const touchedFile = write('touched.txt', ['dirX/bar.ts', 'dirX/tests/bar.test.ts']);

    const proc = run([
      '--added-files', addedFile,
      '--touched-files', touchedFile,
      '--base-tree-files', baseTreeFile,
    ]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toEqual({ ok: true, id: 'V-TEST-01' });
  });
});
