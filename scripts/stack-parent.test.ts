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
  test('joins the plan package_root onto sub-package Touch-Paths (#1462)', () => {
    const state = setup();
    fs.writeFileSync(path.join(state, 'plans', 'issue-1376.md'), `---\npackage_root: apps/invest\n---\n${plan}`);
    expect(runPlan(state, '1376')).toEqual(['apps/invest/scripts/lib/foo.test.ts']);
  });
  test('prints null when there is no plan or it declares no Touch-Paths', () => {
    const state = setup();
    expect(runPlan(state, '1376')).toBeNull();
    fs.writeFileSync(path.join(state, 'plans', 'issue-1376.md'), '# Plan\n');
    expect(runPlan(state, '1376')).toBeNull();
  });
});

// The dispatch glue (targetBranch + pureAdditions) is exercised against a real temp git repo: a
// parent PR ref under refs/blackhole/pr/ and the target branch under refs/remotes/origin/.
describe('stack-parent.ts --issue pure-addition glue (#1555)', () => {
  const INDEX = 'documentation/decisions/INDEX.md';
  const git = (repo: string, ...args: string[]): string => {
    const r = Bun.spawnSync(['git', '-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
    expect(r.exitCode).toBe(0);
    return r.stdout.toString().trim();
  };

  /** Repo whose `origin/<target>` holds a 2-row INDEX; PR 1385's ref carries `indexAtPr` as that file. */
  const setupRepo = (indexAtPr: string, target = 'main'): string => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'documentation', 'decisions'), { recursive: true });
    git(repo, 'init', '-q');
    const write = (content: string): void => fs.writeFileSync(path.join(repo, INDEX), content);
    write('| ADR-1 |\n| ADR-2 |\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    git(repo, 'update-ref', `refs/remotes/origin/${target}`, 'HEAD');
    write(indexAtPr);
    git(repo, 'commit', '-q', '-am', 'parent pr');
    git(repo, 'update-ref', 'refs/blackhole/pr/1385', 'HEAD');
    return repo;
  };

  const dispatchWith = (repo: string, config?: unknown): { parent: number } | null => {
    const state = setup();
    // Issue 1376 declares the index itself, so the only thing keeping it off 1381 is the pure-addition exemption.
    fs.writeFileSync(
      path.join(state, 'queue.json'),
      JSON.stringify({
        issues: {
          '1381': { status: 'in-flight', pr: 1385, touch_paths: [INDEX] },
          '1376': { status: 'ready', pr: null, touch_paths: [INDEX] },
        },
      }),
    );
    if (config !== undefined) fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify(config));
    const r = Bun.spawnSync(
      ['bun', 'run', script, '--queue', path.join(state, 'queue.json'), '--issue', '1376', '--repo-root', repo, '--parent-files', JSON.stringify({ '1381': [INDEX] })],
      { cwd: tmp },
    );
    expect(r.exitCode).toBe(0);
    return JSON.parse(r.stdout.toString());
  };

  test('a parent PR that only appends rows to the decisions index does not parent the issue', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-parent-glue-'));
    expect(dispatchWith(setupRepo('| ADR-1 |\n| ADR-2 |\n| ADR-3 |\n'))).toBeNull();
  });
  test('a parent PR that edits an existing row still parents the issue', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-parent-glue-'));
    expect((dispatchWith(setupRepo('| ADR-1 |\n| ADR-2 edited |\n')) as { parent: number }).parent).toBe(1381);
  });
  test('target_branch from config.json selects the base the PR is measured against', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-parent-glue-'));
    // origin/develop exists, origin/main does not: with the default base the numstat finds no merge base and the file stays an overlap.
    const repo = setupRepo('| ADR-1 |\n| ADR-2 |\n| ADR-3 |\n', 'develop');
    expect((dispatchWith(repo) as { parent: number }).parent).toBe(1381);
    expect(dispatchWith(repo, { target_branch: 'develop' })).toBeNull();
  });
});
