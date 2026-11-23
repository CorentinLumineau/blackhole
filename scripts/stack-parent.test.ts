import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// CLI: `--issue` reads plans/issue-<N>.md beside the queue, or from --plans-dir.
const script = path.join(import.meta.dirname, 'stack-parent.ts');
const parentFiles = JSON.stringify({ '1381': ['scripts/lib/bar.ts'] });
const plan = '# Plan\n\n## Touch-Paths\n\n- `scripts/lib/foo.test.ts`\n';

let tmp = '';
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

const setup = (): string => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-parent-cli-'));
  const state = path.join(tmp, '.blackhole');
  fs.mkdirSync(path.join(state, 'plans'), { recursive: true });
  const issues = {
    '1381': { status: 'in-flight', pr: 1385, touch_paths: ['scripts/lib/bar.ts'] },
    '1376': { status: 'ready', pr: null, touch_paths: ['src/**', 'scripts/**', 'fixtures/**'] },
  };
  fs.writeFileSync(path.join(state, 'queue.json'), JSON.stringify({ issues }));
  return state;
};

const run = (state: string, extra: string[] = []): unknown => {
  const r = Bun.spawnSync(
    ['bun', 'run', script, '--queue', path.join(state, 'queue.json'), '--issue', '1376', '--parent-files', parentFiles, ...extra],
    { cwd: tmp },
  );
  expect(r.exitCode).toBe(0);
  return JSON.parse(r.stdout.toString());
};

describe('stack-parent.ts --issue', () => {
  test('without a plan the default globs stack on the unrelated open PR', () => {
    expect((run(setup()) as { parent: number }).parent).toBe(1381);
  });
  test('reads the plan from plans/ beside the queue by default', () => {
    const state = setup();
    fs.writeFileSync(path.join(state, 'plans', 'issue-1376.md'), plan);
    expect(run(state)).toBeNull();
  });
  test('--plans-dir overrides the plans location', () => {
    const state = setup();
    const other = path.join(tmp, 'elsewhere');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'issue-1376.md'), plan);
    expect((run(state) as { parent: number }).parent).toBe(1381);
    expect(run(state, ['--plans-dir', other])).toBeNull();
  });
});
