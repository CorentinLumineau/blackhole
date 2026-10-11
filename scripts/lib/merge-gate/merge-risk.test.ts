import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { root } from '../build/paths.ts';
import { makeTempDir, cleanupDirEntries } from '../fs.ts';
import {
  classifyMergeRisk,
  filesFromNameStatus,
  isBlackholeCampaignBranch,
  isTestPath,
  NEEDS_CHEF_COMMENT_PREFIX,
  parseMergeRiskSnapshot,
  patchesFromUnifiedDiff,
  type ChangedFile,
} from './merge-risk.ts';

const file = (p: string, status = 'M'): ChangedFile => ({ path: p, status });

describe('classifyMergeRisk', () => {
  test('a docs-and-scripts PR is low-risk and automergeable on a campaign branch', () => {
    const verdict = classifyMergeRisk({
      files: [file('src/references/merge-gate.md'), file('scripts/lib/merge-gate/merge-risk.ts')],
      headRef: 'blackhole/issue-42',
    });
    expect(verdict).toMatchObject({ low_risk: true, own_pr: true, automerge: true, reasons: [] });
  });

  test('each high-risk category refuses automerge', () => {
    const cases: Array<{ path: string; category: string }> = [
      { path: 'src/auth/login.ts', category: 'auth-login' },
      { path: 'apps/web/oauth.ts', category: 'auth-login' },
      { path: '.env', category: 'secrets-env' },
      { path: '.env.production', category: 'secrets-env' },
      { path: 'config/secrets.json', category: 'secrets-env' },
      { path: 'tls/server.pem', category: 'secrets-env' },
      { path: 'config/prod-database.yml', category: 'prod-db' },
      { path: 'db/migrations/001_init.sql', category: 'migrations' },
      { path: 'prisma/migrations/20240101_add_users/migration.sql', category: 'migrations' },
      { path: '.github/workflows/ci.yml', category: 'github-workflows' },
      { path: 'scripts/release.ts', category: 'release-tag' },
      { path: '.github/releases/v1.0.0.md', category: 'release-tag' },
    ];
    for (const { path: p, category } of cases) {
      const verdict = classifyMergeRisk({ files: [file(p)], headRef: 'blackhole/issue-1' });
      expect(verdict.automerge, p).toBe(false);
      expect(verdict.low_risk, p).toBe(false);
      expect(verdict.reasons.map((r) => r.category), p).toContain(category);
      expect(verdict.reasons.find((r) => r.category === category)?.paths, p).toContain(p);
    }
  });

  test('deleting a data file is deletes-data; deleting source is not', () => {
    const data = classifyMergeRisk({
      files: [{ path: 'data/users.csv', status: 'D' }],
      headRef: 'blackhole/issue-1',
    });
    expect(data.reasons.map((r) => r.category)).toContain('deletes-data');
    expect(classifyMergeRisk({ files: [{ path: 'src/foo.ts', status: 'D' }], headRef: 'blackhole/issue-1' }).low_risk).toBe(true);
  });

  test('destructive SQL in a non-test patch is deletes-data; the same SQL in a test is not', () => {
    const prod = classifyMergeRisk({
      files: [file('src/cleanup.ts')],
      patches: [{ path: 'src/cleanup.ts', patch: '+ DELETE FROM users WHERE stale' }],
      headRef: 'blackhole/issue-1',
    });
    expect(prod.reasons.map((r) => r.category)).toContain('deletes-data');
    const testFile = classifyMergeRisk({
      files: [file('src/cleanup.test.ts')],
      patches: [{ path: 'src/cleanup.test.ts', patch: '+ DELETE FROM users WHERE stale' }],
      headRef: 'blackhole/issue-1',
    });
    expect(testFile.low_risk).toBe(true);
  });

  test('DROP TABLE and TRUNCATE classify as deletes-data', () => {
    for (const sql of ['DROP TABLE accounts', 'TRUNCATE TABLE sessions', 'DROP DATABASE app']) {
      const verdict = classifyMergeRisk({
        files: [file('ops/reset.sql')],
        patches: [{ path: 'ops/reset.sql', patch: `+ ${sql}` }],
        headRef: 'blackhole/issue-1',
      });
      expect(verdict.reasons.map((r) => r.category), sql).toContain('deletes-data');
    }
  });

  test('a package.json version bump is release/tag tooling', () => {
    const verdict = classifyMergeRisk({
      files: [file('package.json')],
      patches: [{ path: 'package.json', patch: '-  "version": "0.23.0"\n+  "version": "0.24.0"\n' }],
      headRef: 'blackhole/issue-1',
    });
    expect(verdict.reasons.map((r) => r.category)).toContain('release-tag');
  });

  test('a renamed high-risk path still classifies against both names', () => {
    const verdict = classifyMergeRisk({
      files: [{ path: 'src/login.ts', status: 'R', previousPath: 'src/auth/session.ts' }],
      headRef: 'blackhole/issue-1',
    });
    expect(verdict.low_risk).toBe(false);
    const paths = verdict.reasons.flatMap((r) => r.paths);
    expect(paths).toContain('src/login.ts');
    expect(paths).toContain('src/auth/session.ts');
  });

  test('a non-campaign head is not automerge even when the diff is low-risk', () => {
    const verdict = classifyMergeRisk({
      files: [file('README.md')],
      headRef: 'cursor/low-risk-squash-merge-0dba',
    });
    expect(verdict).toMatchObject({ low_risk: true, own_pr: false, automerge: false });
    expect(verdict.comment).toContain(NEEDS_CHEF_COMMENT_PREFIX);
    expect(verdict.comment).toContain('not a blackhole campaign PR');
  });

  test('an omitted head ref is treated as a campaign PR', () => {
    expect(classifyMergeRisk({ files: [file('README.md')] }).own_pr).toBe(true);
    expect(classifyMergeRisk({ files: [file('README.md')] }).automerge).toBe(true);
  });

  test('the needs-chef comment lists every firing category', () => {
    const verdict = classifyMergeRisk({
      files: [file('.github/workflows/ci.yml'), file('db/migrations/002.sql')],
      headRef: 'blackhole/issue-9',
    });
    expect(verdict.comment.startsWith(NEEDS_CHEF_COMMENT_PREFIX)).toBe(true);
    expect(verdict.comment).toContain('.github/workflows');
    expect(verdict.comment).toContain('migrations');
    expect(verdict.comment).toContain('Chef (orchestrator)');
  });
});

describe('isBlackholeCampaignBranch', () => {
  test('matches blackhole/issue-N including origin/ and refs/heads/ prefixes', () => {
    expect(isBlackholeCampaignBranch('blackhole/issue-12')).toBe(true);
    expect(isBlackholeCampaignBranch('origin/blackhole/issue-12')).toBe(true);
    expect(isBlackholeCampaignBranch('refs/heads/blackhole/issue-12')).toBe(true);
    expect(isBlackholeCampaignBranch('blackhole/issue-12-fix')).toBe(false);
    expect(isBlackholeCampaignBranch('cursor/foo')).toBe(false);
    expect(isBlackholeCampaignBranch(null)).toBe(true);
  });
});

describe('filesFromNameStatus / patchesFromUnifiedDiff', () => {
  test('parses git name-status including renames', () => {
    const files = filesFromNameStatus('M\tsrc/foo.ts\nA\t.github/workflows/ci.yml\nR100\told.ts\tnew.ts\n');
    expect(files).toEqual([
      { path: 'src/foo.ts', status: 'M' },
      { path: '.github/workflows/ci.yml', status: 'A' },
      { path: 'new.ts', status: 'R', previousPath: 'old.ts' },
    ]);
  });

  test('splits a unified diff on diff --git headers', () => {
    const patches = patchesFromUnifiedDiff(
      'diff --git a/src/a.ts b/src/a.ts\n+ ok\ndiff --git a/db/x.sql b/db/x.sql\n+ DELETE FROM t\n',
    );
    expect(patches).toHaveLength(2);
    expect(patches[1].path).toBe('db/x.sql');
    expect(patches[1].patch).toContain('DELETE FROM');
  });

  test('a headerless blob is one patch so a raw SQL snippet still classifies', () => {
    expect(patchesFromUnifiedDiff('DELETE FROM t').map((p) => p.path)).toEqual(['(patch)']);
  });
});

describe('parseMergeRiskSnapshot', () => {
  test('rejects a snapshot with no files array', () => {
    expect(() => parseMergeRiskSnapshot({ description: 'x' })).toThrow('files must be an array');
    expect(() => parseMergeRiskSnapshot(null)).toThrow('must be an object');
  });
});

describe('isTestPath', () => {
  test('test and fixture paths are excluded from the SQL deletes-data scan', () => {
    expect(isTestPath('scripts/lib/merge-gate/merge-risk.test.ts')).toBe(true);
    expect(isTestPath('fixtures/ci-verdict/pr-event-green.json')).toBe(true);
    expect(isTestPath('src/cleanup.ts')).toBe(false);
  });
});

describe('merge-risk CLI', () => {
  const tmp = makeTempDir('merge-risk-cli');
  const run = (args: string[]) =>
    spawnSync('bun', ['run', path.join(root, 'scripts', 'merge-risk.ts'), ...args], { encoding: 'utf-8' });

  test('exits 0 on a low-risk snapshot, 1 on high-risk, 2 on a malformed call', () => {
    const green = path.join(tmp, 'green.json');
    fs.writeFileSync(green, JSON.stringify({ files: [{ path: 'src/foo.ts', status: 'M' }], headRef: 'blackhole/issue-1' }));
    const greenRun = run(['--files', green]);
    expect(greenRun.status).toBe(0);
    expect(JSON.parse(greenRun.stdout).automerge).toBe(true);

    const red = path.join(tmp, 'red.json');
    fs.writeFileSync(red, JSON.stringify({ files: [{ path: '.github/workflows/ci.yml', status: 'M' }], headRef: 'blackhole/issue-1' }));
    const redRun = run(['--files', red]);
    expect(redRun.status).toBe(1);
    expect(JSON.parse(redRun.stdout).automerge).toBe(false);
    expect(JSON.parse(redRun.stdout).comment).toContain(NEEDS_CHEF_COMMENT_PREFIX);

    expect(run([]).status).toBe(2);
    expect(run(['--bogus', 'x']).status).toBe(2);
  });

  test('--name-status plus --patches plus --head-ref classifies a SQL deletion', () => {
    const names = path.join(tmp, 'names.txt');
    const diff = path.join(tmp, 'pr.diff');
    fs.writeFileSync(names, 'M\tsrc/cleanup.ts\n');
    fs.writeFileSync(diff, 'diff --git a/src/cleanup.ts b/src/cleanup.ts\n+ DROP TABLE users;\n');
    const result = run(['--name-status', names, '--patches', diff, '--head-ref', 'blackhole/issue-3']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).reasons.map((r: { category: string }) => r.category)).toContain('deletes-data');
  });

  test('a malformed JSON snapshot is usage (exit 2), not a silent hold', () => {
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{');
    expect(run(['--files', bad]).status).toBe(2);
  });

  afterAll(() => cleanupDirEntries(tmp));
});
