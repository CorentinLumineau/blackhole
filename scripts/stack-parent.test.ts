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

describe('stack-parent.ts --issue reads config.json beside the queue (#1458)', () => {
  const writeConfig = (state: string, cfg: unknown): void =>
    fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify(cfg));

  test('an unplanned issue does not stack on its config default globs', () => {
    const state = setup();
    writeConfig(state, { default_touch_paths: ['src/**', 'scripts/**', 'fixtures/**'] });
    expect(run(state)).toBeNull();
  });
  test('an explicit --default-touch-paths wins over config.json', () => {
    const state = setup();
    writeConfig(state, { default_touch_paths: ['src/**', 'scripts/**', 'fixtures/**'] });
    expect((run(state, ['--default-touch-paths', '[]']) as { parent: number }).parent).toBe(1381);
  });
  test('a plan named <N>.md is read when issue-<N>.md is absent', () => {
    const state = setup();
    fs.writeFileSync(path.join(state, 'plans', '1376.md'), plan);
    expect(run(state)).toBeNull();
  });
});

describe('stack-parent.ts --plan-touch-paths (#1458)', () => {
  const runPlan = (state: string, issue: string): unknown => {
    const r = Bun.spawnSync(['bun', 'run', script, '--queue', path.join(state, 'queue.json'), '--plan-touch-paths', issue], { cwd: tmp });
    expect(r.exitCode).toBe(0);
    return JSON.parse(r.stdout.toString());
  };
  test('prints the plan Touch-Paths to write into the queue entry', () => {
    const state = setup();
    fs.writeFileSync(path.join(state, 'plans', 'issue-1376.md'), plan);
    expect(runPlan(state, '1376')).toEqual(['scripts/lib/foo.test.ts']);
  });
  test('prints null when there is no plan or it declares no Touch-Paths', () => {
    const state = setup();
    expect(runPlan(state, '1376')).toBeNull();
    fs.writeFileSync(path.join(state, 'plans', 'issue-1376.md'), '# Plan\n');
    expect(runPlan(state, '1376')).toBeNull();
  });
});
