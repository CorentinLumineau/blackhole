import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';

// Issue #715 (R-10) — CLI argv-parsing/exit-code tests for scripts/carry-staged-artifacts.ts.
// Async Bun.spawn assertions can't use lib/test-fixtures.ts's synchronous withTempDir (its
// `finally` cleanup would race the still-pending subprocess) — same beforeEach/afterEach +
// makeTempDir/rmSync convention as scripts/validate-worker-json.test.ts's CLI suites.

const root = path.resolve(import.meta.dirname);
const scriptPath = path.join(root, 'carry-staged-artifacts.ts');

const runRaw = (args: string[]) => Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

let dir: string;
let activeConfigPath: string;

// Every pre-existing suite below exercises the active carry path, so `run` points the CLI's
// docs_governance gate at a config that enables it. The gate tests use `runRaw` instead.
const run = (args: string[]) => runRaw(['--config', activeConfigPath, ...args]);

beforeEach(() => {
  dir = makeTempDir('carry-cli');
  const configDir = makeTempDir('carry-cli-config');
  activeConfigPath = path.join(configDir, 'config.json');
  fs.writeFileSync(activeConfigPath, JSON.stringify({ docs_governance: { enabled: true } }));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.dirname(activeConfigPath), { recursive: true, force: true });
});

describe('carry-staged-artifacts CLI — argv parsing', () => {
  test('missing --manifest exits 2 with usage on stderr', async () => {
    const proc = run(['--repo-root', dir]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('missing --repo-root exits 2 with usage on stderr', async () => {
    const proc = run(['--manifest', path.join(dir, 'manifest.json')]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  // Regression coverage: a complete, valid required-flag set alongside one unrecognized flag
  // must still exit 2 — an unrecognized flag is malformed usage, not a value to silently drop.
  test('a valid required-flag set plus one unrecognized flag exits 2 with usage on stderr', async () => {
    const proc = run(['--manifest', path.join(dir, 'missing.json'), '--repo-root', dir, '--bogus-flag']);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });
});

describe('carry-staged-artifacts CLI — manifest shape guard', () => {
  test('absent manifest: prints [] and exits 0', async () => {
    const proc = run(['--manifest', path.join(dir, 'missing.json'), '--repo-root', dir]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('[]');
  });

  test('zero-byte manifest: exits 1 and names the manifest path on stderr', async () => {
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, '');
    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain(manifestPath);
    expect(stderr).toContain('staging write failed; do not skip the carry');
  });

  test('unparseable manifest: exits 1', async () => {
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, '{ not json');
    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const code = await proc.exited;
    expect(code).toBe(1);
  });
});

describe('carry-staged-artifacts CLI — end to end', () => {
  test('carries a new_file entry and prints its target path as a JSON array', async () => {
    const stagedRel = '.blackhole/staged/1/plan-x.md';
    fs.mkdirSync(path.join(dir, path.dirname(stagedRel)), { recursive: true });
    fs.writeFileSync(path.join(dir, stagedRel), '---\ntype: plan\nstatus: current\n---\n# Plan\n');

    const manifest = {
      issue: 1,
      updated_at: '2026-08-06T18:00:00.000Z',
      entries: [
        {
          route: 'plan',
          sub_mode: null,
          produced_by: 'planner',
          declared_at: '2026-08-06T17:58:00.000Z',
          staged_path: stagedRel,
          target_path: 'documentation/plans/plan-x.md',
          target_kind: 'new_file',
        },
      ],
    };
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    // + documentation/INDEX.md — auto-regenerated (issue #832, ADR-031 Phase 2).
    expect(JSON.parse(stdout)).toEqual(['documentation/plans/plan-x.md', 'documentation/INDEX.md']);
    expect(fs.existsSync(path.join(dir, 'documentation/plans/plan-x.md'))).toBe(true);
  });

  test('reports a malformed entry on stderr and still carries the well-formed remainder', async () => {
    const stagedRel = '.blackhole/staged/1/plan-x.md';
    fs.mkdirSync(path.join(dir, path.dirname(stagedRel)), { recursive: true });
    fs.writeFileSync(path.join(dir, stagedRel), '# Plan\n');

    const manifest = {
      issue: 1,
      updated_at: '2026-08-06T18:00:00.000Z',
      entries: [
        { route: 'plan', sub_mode: null, produced_by: 'planner', declared_at: 'x' }, // missing staged_path/target_path/target_kind
        {
          route: 'plan',
          sub_mode: null,
          produced_by: 'planner',
          declared_at: '2026-08-06T17:58:00.000Z',
          staged_path: stagedRel,
          target_path: 'documentation/plans/plan-x.md',
          target_kind: 'new_file',
        },
      ],
    };
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(code).toBe(0);
    // + documentation/INDEX.md — auto-regenerated (issue #832, ADR-031 Phase 2).
    expect(JSON.parse(stdout)).toEqual(['documentation/plans/plan-x.md', 'documentation/INDEX.md']);
    expect(stderr).toContain('entries[0]');
  });
});

describe('carry-staged-artifacts CLI — --staging-root (issue #760)', () => {
  const manifestFor = (stagedRel: string, targetPath: string) => ({
    issue: 1,
    updated_at: '2026-08-06T18:00:00.000Z',
    entries: [
      {
        route: 'plan',
        sub_mode: null,
        produced_by: 'planner',
        declared_at: '2026-08-06T17:58:00.000Z',
        staged_path: stagedRel,
        target_path: targetPath,
        target_kind: 'new_file',
      },
    ],
  });

  test('--staging-root resolves staged_path from a distinct dir; target still lands under --repo-root', async () => {
    const manifestDir = makeTempDir('carry-cli-manifest');
    const stagingDir = makeTempDir('carry-cli-staging');
    const repoRootDir = makeTempDir('carry-cli-repo-root');
    try {
      const stagedRel = '.blackhole/staged/1/plan-x.md';
      fs.mkdirSync(path.join(stagingDir, path.dirname(stagedRel)), { recursive: true });
      fs.writeFileSync(path.join(stagingDir, stagedRel), '# Plan\n');

      const manifest = manifestFor(stagedRel, 'documentation/plans/plan-x.md');
      const manifestPath = path.join(manifestDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const proc = run([
        '--manifest',
        manifestPath,
        '--repo-root',
        repoRootDir,
        '--staging-root',
        stagingDir,
      ]);
      const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
      expect(code).toBe(0);
      // + documentation/INDEX.md — auto-regenerated (issue #832, ADR-031 Phase 2).
      expect(JSON.parse(stdout)).toEqual(['documentation/plans/plan-x.md', 'documentation/INDEX.md']);
      expect(fs.existsSync(path.join(repoRootDir, 'documentation/plans/plan-x.md'))).toBe(true);
    } finally {
      fs.rmSync(manifestDir, { recursive: true, force: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.rmSync(repoRootDir, { recursive: true, force: true });
    }
  });

  test('a declared staged_path absent under --staging-root exits 1 and names both roots plus the entry index on stderr, never a bare ENOENT', async () => {
    const stagingDir = makeTempDir('carry-cli-staging');
    const repoRootDir = makeTempDir('carry-cli-repo-root');
    try {
      const stagedRel = '.blackhole/staged/1/plan-x.md'; // deliberately never written under stagingDir
      const manifest = manifestFor(stagedRel, 'documentation/plans/plan-x.md');
      const manifestPath = path.join(dir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const proc = run([
        '--manifest',
        manifestPath,
        '--repo-root',
        repoRootDir,
        '--staging-root',
        stagingDir,
      ]);
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      expect(code).toBe(1);
      expect(stderr).toContain(repoRootDir);
      expect(stderr).toContain(stagingDir);
      expect(stderr).toContain('entries[0]');
      expect(stderr).not.toMatch(/^\s*Error: ENOENT/m);
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.rmSync(repoRootDir, { recursive: true, force: true });
    }
  });

  test('a manifest whose every entry is malformed carries nothing and exits 1 — distinguishable from the absent-manifest case', async () => {
    const manifest = {
      issue: 1,
      updated_at: '2026-08-06T18:00:00.000Z',
      entries: [{ route: 'plan', sub_mode: null, produced_by: 'planner', declared_at: 'x' }], // missing staged_path/target_path/target_kind
    };
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toEqual([]);
  });
});

describe('carry-staged-artifacts CLI — path containment (issue #752)', () => {
  test('an entry whose target_path escapes --repo-root is reported on stderr, never written, and does not block the remaining entry', async () => {
    // repoRoot nests inside the fixture dir so the `..` escape target stays under the temp tree.
    const repoRoot = path.join(dir, 'repo');
    fs.mkdirSync(repoRoot);
    const stagedRel = '.blackhole/staged/1/plan-x.md';
    fs.mkdirSync(path.join(repoRoot, path.dirname(stagedRel)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, stagedRel), '# Plan\n');

    const entry = (targetPath: string) => ({
      route: 'plan',
      sub_mode: null,
      produced_by: 'planner',
      declared_at: '2026-08-06T17:58:00.000Z',
      staged_path: stagedRel,
      target_path: targetPath,
      target_kind: 'new_file',
    });
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        issue: 1,
        updated_at: '2026-08-06T18:00:00.000Z',
        entries: [entry('../escape.md'), entry('documentation/plans/plan-x.md')],
      }),
    );

    const proc = run(['--manifest', manifestPath, '--repo-root', repoRoot]);
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    expect(code).toBe(0);
    // + documentation/INDEX.md — auto-regenerated (issue #832, ADR-031 Phase 2).
    expect(JSON.parse(stdout)).toEqual(['documentation/plans/plan-x.md', 'documentation/INDEX.md']);
    expect(stderr).toContain('entries[0]');
    expect(stderr).toContain('target_path');
    expect(stderr).toContain(repoRoot);
    expect(fs.existsSync(path.join(dir, 'escape.md'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'documentation/plans/plan-x.md'))).toBe(true);
  });
});

describe('carry-staged-artifacts CLI — carry target allowlist (issue #784 AC1)', () => {
  test('an in-root target_path of "package.json" passes containment but is refused by the allowlist, with the reason on stderr, and is never written', async () => {
    const repoRoot = path.join(dir, 'repo');
    fs.mkdirSync(repoRoot);
    const stagedRel = '.blackhole/staged/1/plan-x.md';
    fs.mkdirSync(path.join(repoRoot, path.dirname(stagedRel)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, stagedRel), '# Plan\n');

    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        issue: 1,
        updated_at: '2026-08-06T18:00:00.000Z',
        entries: [
          {
            route: 'plan',
            sub_mode: null,
            produced_by: 'planner',
            declared_at: '2026-08-06T17:58:00.000Z',
            staged_path: stagedRel,
            target_path: 'package.json',
            target_kind: 'new_file',
          },
        ],
      }),
    );

    const proc = run(['--manifest', manifestPath, '--repo-root', repoRoot]);
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    // Every entry skipped and nothing carried: exit 1, so the refusal cannot read as success.
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toEqual([]);
    expect(stderr).toContain('skipped entries[0]');
    expect(stderr).toContain('target_path "package.json" is outside the carry allowlist');
    expect(fs.existsSync(path.join(repoRoot, 'package.json'))).toBe(false);
  });
});

describe('carry-staged-artifacts CLI — docs_governance gate (issue #1400)', () => {
  const stagedRel = '.blackhole/staged/1/plan-x.md';
  const writeStagedPlan = (root: string): string => {
    fs.mkdirSync(path.join(root, path.dirname(stagedRel)), { recursive: true });
    fs.writeFileSync(path.join(root, stagedRel), '# Plan\n');
    const manifestPath = path.join(root, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        issue: 1,
        updated_at: '2026-08-06T18:00:00.000Z',
        entries: [
          {
            route: 'plan',
            sub_mode: null,
            produced_by: 'planner',
            declared_at: '2026-08-06T17:58:00.000Z',
            staged_path: stagedRel,
            target_path: 'documentation/plans/plan-x.md',
            target_kind: 'new_file',
          },
        ],
      }),
    );
    return manifestPath;
  };
  const writeConfig = (file: string, body: unknown): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  };
  const collect = async (proc: ReturnType<typeof runRaw>) => {
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code, stdout, stderr };
  };

  test('default config path is <staging-root>/.blackhole/config.json: enabled there carries into --repo-root', async () => {
    const stagingDir = makeTempDir('carry-cli-staging');
    const repoRootDir = makeTempDir('carry-cli-repo-root');
    try {
      const manifestPath = writeStagedPlan(stagingDir);
      writeConfig(path.join(stagingDir, '.blackhole', 'config.json'), { docs_governance: { enabled: true } });
      const { code, stdout } = await collect(
        runRaw(['--manifest', manifestPath, '--repo-root', repoRootDir, '--staging-root', stagingDir]),
      );
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toContain('documentation/plans/plan-x.md');
      expect(fs.existsSync(path.join(repoRootDir, 'documentation/plans/plan-x.md'))).toBe(true);
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.rmSync(repoRootDir, { recursive: true, force: true });
    }
  });

  test('default config path falls back to <repo-root>/.blackhole/config.json when --staging-root is absent', async () => {
    const manifestPath = writeStagedPlan(dir);
    writeConfig(path.join(dir, '.blackhole', 'config.json'), { docs_governance: { enabled: true } });
    const { code, stdout } = await collect(runRaw(['--manifest', manifestPath, '--repo-root', dir]));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toContain('documentation/plans/plan-x.md');
  });

  test('absent config.json is inert: prints [] and exits 0 without writing anything', async () => {
    const manifestPath = writeStagedPlan(dir);
    const { code, stdout } = await collect(runRaw(['--manifest', manifestPath, '--repo-root', dir]));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'documentation'))).toBe(false);
  });

  test('--config overrides the default path: an enabling --config wins over a disabling default config', async () => {
    const manifestPath = writeStagedPlan(dir);
    writeConfig(path.join(dir, '.blackhole', 'config.json'), { docs_governance: { enabled: false } });
    const { code, stdout } = await collect(runRaw(['--config', activeConfigPath, '--manifest', manifestPath, '--repo-root', dir]));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toContain('documentation/plans/plan-x.md');
  });

  test('--config pointing at a disabling config is inert even when the default config enables', async () => {
    const manifestPath = writeStagedPlan(dir);
    writeConfig(path.join(dir, '.blackhole', 'config.json'), { docs_governance: { enabled: true } });
    const off = path.join(dir, 'off.json');
    writeConfig(off, { docs_governance: { enabled: false } });
    const { code, stdout } = await collect(runRaw(['--config', off, '--manifest', manifestPath, '--repo-root', dir]));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'documentation'))).toBe(false);
  });

  test('write_governance:false is inert: prints [] and exits 0', async () => {
    const manifestPath = writeStagedPlan(dir);
    const cfg = path.join(dir, 'cfg.json');
    writeConfig(cfg, { docs_governance: { enabled: true, write_governance: false } });
    const { code, stdout } = await collect(runRaw(['--config', cfg, '--manifest', manifestPath, '--repo-root', dir]));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
  });

  test('inert config never loads the manifest: a malformed manifest does not error', async () => {
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, '{ not json');
    const cfg = path.join(dir, 'cfg.json');
    writeConfig(cfg, { docs_governance: { enabled: false } });
    const { code, stdout } = await collect(runRaw(['--config', cfg, '--manifest', manifestPath, '--repo-root', dir]));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
  });

  test('malformed config.json exits 1 and names the config path on stderr', async () => {
    const manifestPath = writeStagedPlan(dir);
    const cfg = path.join(dir, 'cfg.json');
    writeConfig(cfg, '{ not json');
    const { code, stderr } = await collect(runRaw(['--config', cfg, '--manifest', manifestPath, '--repo-root', dir]));
    expect(code).toBe(1);
    expect(stderr).toContain('carry-staged-artifacts:');
    expect(stderr).toContain(cfg);
    expect(fs.existsSync(path.join(dir, 'documentation'))).toBe(false);
  });
});
