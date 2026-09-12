import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');

const temps: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readEnvJson(): {
  repositoryDependencies?: string[];
  start: string;
  install: string;
} {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'templates/cursor-cloud/environment.json'), 'utf8')) as {
    repositoryDependencies?: string[];
    start: string;
    install: string;
  };
}

function spawnUtf8(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(command, args, { ...opts, encoding: 'utf8' as const });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function git(cwd: string, args: string[]): void {
  const result = spawnUtf8('git', ['-C', cwd, ...args]);
  expect(result.status, result.stderr).toBe(0);
}

function initMercureFixture(repo: string, marker: string, layout: 'cursor-dist' | 'flat'): void {
  const skillsRoot =
    layout === 'cursor-dist' ? join(repo, 'mercure-plugin/cursor-dist/skills') : join(repo, 'skills');
  mkdirSync(join(skillsRoot, 'x-auto'), { recursive: true });
  mkdirSync(join(skillsRoot, 'x-plan'), { recursive: true });
  mkdirSync(join(skillsRoot, '../agents'), { recursive: true });
  writeFileSync(join(skillsRoot, 'x-auto/SKILL.md'), `# x-auto ${marker}\n`);
  writeFileSync(join(skillsRoot, 'x-plan/SKILL.md'), `# x-plan ${marker}\n`);
  spawnSync('git', ['init', '-b', 'main', repo], { encoding: 'utf8' });
  git(repo, ['config', 'user.email', 'plugin-test@example.com']);
  git(repo, ['config', 'user.name', 'plugin-test']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', `init ${marker}`]);
}

function seedCache(home: string, marker: string): string {
  const cachePlugin = join(home, '.cursor/plugins/cache/mercure/1/deadbeef');
  mkdirSync(join(cachePlugin, 'skills/x-auto'), { recursive: true });
  mkdirSync(join(cachePlugin, 'skills/x-plan'), { recursive: true });
  mkdirSync(join(cachePlugin, 'agents'), { recursive: true });
  writeFileSync(join(cachePlugin, 'skills/x-auto/SKILL.md'), `# x-auto ${marker}\n`);
  writeFileSync(join(cachePlugin, 'skills/x-plan/SKILL.md'), `# x-plan ${marker}\n`);
  return cachePlugin;
}

function seedBlackholeCheckout(root: string): void {
  mkdirSync(join(root, '.cursor/skills/blackhole'), { recursive: true });
  mkdirSync(join(root, '.cursor/agents'), { recursive: true });
  mkdirSync(join(root, '.cursor/rules'), { recursive: true });
  writeFileSync(join(root, '.cursor/skills/blackhole/SKILL.md'), '# blackhole\n');
  writeFileSync(join(root, '.cursor/agents/coordinator.md'), '# coordinator\n');
}

function runPlugins(opts: {
  root: string;
  home: string;
  cloneUrl?: string;
  extraEnv?: NodeJS.ProcessEnv;
}): { status: number | null; stderr: string; stdout: string } {
  mkdirSync(join(opts.root, 'scripts'), { recursive: true });
  seedBlackholeCheckout(opts.root);
  writeFileSync(
    join(opts.root, 'scripts/cloud-agent-plugins.sh'),
    readFileSync(join(REPO_ROOT, 'scripts/cloud-agent-plugins.sh')),
  );
  return spawnUtf8('bash', [join(opts.root, 'scripts/cloud-agent-plugins.sh')], {
    env: {
      ...process.env,
      HOME: opts.home,
      MERCURE_CLONE_URL: opts.cloneUrl ?? '/no/such/mercure-clone',
      BLACKHOLE_CLONE_URL: '/no/such/blackhole-clone',
      ...opts.extraEnv,
    },
  });
}

describe('cloud-agent Mercure + Blackhole plugin access', () => {
  test('lists both GitHub plugin repos as repositoryDependencies', () => {
    const env = readEnvJson();
    expect(env.repositoryDependencies).toEqual([
      'github.com/CorentinLumineau/blackhole',
      'github.com/CorentinLumineau/mercure',
    ]);
  });

  test('enables both Cursor plugins in the cursor-cloud settings template', () => {
    const settings = JSON.parse(
      readFileSync(join(REPO_ROOT, 'templates/cursor-cloud/settings.json'), 'utf8'),
    ) as { plugins?: Record<string, { enabled?: boolean }> };
    expect(settings.plugins?.['mercure/mercure']?.enabled).toBe(true);
    expect(settings.plugins?.['blackhole/blackhole']?.enabled).toBe(true);
  });

  test('runs cloud-agent-plugins.sh from both install and start', () => {
    const env = readEnvJson();
    expect(env.install).toContain('cloud-agent-plugins.sh');
    expect(env.start).toContain('cloud-agent-plugins.sh');
    expect(env.install).toContain('bun install');
  });

  test('prefers a GitHub clone over a stale marketplace cache', () => {
    const root = tempDir('cloud-agent-plugins-');
    const home = tempDir('cloud-agent-home-');
    const fixture = tempDir('mercure-gh-');
    initMercureFixture(fixture, 'from-github', 'cursor-dist');
    seedCache(home, 'from-cache');

    const result = runPlugins({ root, home, cloneUrl: fixture });
    expect(result.status, result.stderr).toBe(0);

    const overlay = readFileSync(join(root, '.cursor/skills/x-auto/SKILL.md'), 'utf8');
    expect(overlay).toContain('from-github');
    expect(overlay).not.toContain('from-cache');

    const localSkills = join(home, '.cursor/plugins/local/mercure/skills');
    expect(readFileSync(join(localSkills, 'x-auto/SKILL.md'), 'utf8')).toContain('from-github');
    expect(lstatSync(localSkills).isSymbolicLink()).toBe(false);
    expect(result.stderr).toContain('x-auto present=1');
    expect(result.stderr).toContain('blackhole present=1');
    expect(result.stderr).toMatch(/github|clone|cursor-dist/i);
  });

  test('overlays x-auto from mercure-plugin/cursor-dist after a GitHub clone with empty cache', () => {
    const root = tempDir('cloud-agent-plugins-');
    const home = tempDir('cloud-agent-home-');
    const fixture = tempDir('mercure-gh-');
    initMercureFixture(fixture, 'empty-cache-clone', 'cursor-dist');

    const result = runPlugins({ root, home, cloneUrl: fixture });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, '.cursor/skills/x-auto/SKILL.md'), 'utf8')).toContain(
      'empty-cache-clone',
    );
    expect(result.stderr).toContain('x-auto present=1');
  });

  test('updates an existing GitHub clone on a later run', () => {
    const root = tempDir('cloud-agent-plugins-');
    const home = tempDir('cloud-agent-home-');
    const fixture = tempDir('mercure-gh-');
    initMercureFixture(fixture, 'v1', 'cursor-dist');
    const first = runPlugins({ root, home, cloneUrl: fixture });
    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(join(root, '.cursor/skills/x-auto/SKILL.md'), 'utf8')).toContain('v1');

    writeFileSync(join(fixture, 'mercure-plugin/cursor-dist/skills/x-auto/SKILL.md'), '# x-auto v2\n');
    git(fixture, ['add', '.']);
    git(fixture, ['commit', '-m', 'v2']);

    const second = runPlugins({ root, home, cloneUrl: fixture });
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(root, '.cursor/skills/x-auto/SKILL.md'), 'utf8')).toContain('v2');
  });

  test('falls back to the marketplace cache when the GitHub clone is impossible', () => {
    const root = tempDir('cloud-agent-plugins-');
    const home = tempDir('cloud-agent-home-');
    seedCache(home, 'from-cache');
    const result = runPlugins({ root, home, cloneUrl: '/no/such/mercure-clone' });
    expect(result.status, result.stderr).toBe(0);

    const localSkills = join(home, '.cursor/plugins/local/mercure/skills');
    expect(readFileSync(join(localSkills, 'x-auto/SKILL.md'), 'utf8')).toContain('from-cache');
    expect(lstatSync(localSkills).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, '.cursor/skills/x-auto/SKILL.md'), 'utf8')).toContain('from-cache');
    expect(result.stderr).toContain('x-auto present=1');
    expect(result.stderr).toMatch(/cache fallback|marketplace cache/i);
    expect(result.stderr).toContain('github.com/apps/cursor');
  });

  test('replaces a cache-symlink local plugin with a real copy on cache fallback', () => {
    const root = tempDir('cloud-agent-plugins-');
    const home = tempDir('cloud-agent-home-');
    const cachePlugin = seedCache(home, 'from-cache');
    const local = join(home, '.cursor/plugins/local/mercure');
    mkdirSync(local, { recursive: true });
    symlinkSync(join(cachePlugin, 'skills'), join(local, 'skills'));
    symlinkSync(join(cachePlugin, 'agents'), join(local, 'agents'));

    const result = runPlugins({ root, home, cloneUrl: '/no/such/mercure-clone' });
    expect(result.status, result.stderr).toBe(0);
    expect(lstatSync(join(local, 'skills')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, '.cursor/skills/x-auto/SKILL.md'), 'utf8')).toContain('from-cache');
  });

  test('materializes blackhole from this checkout into ~/.cursor/plugins/local', () => {
    const root = tempDir('cloud-agent-plugins-');
    const home = tempDir('cloud-agent-home-');
    const fixture = tempDir('mercure-gh-');
    initMercureFixture(fixture, 'from-github', 'cursor-dist');

    const result = runPlugins({ root, home, cloneUrl: fixture });
    expect(result.status, result.stderr).toBe(0);
    const localSkill = join(home, '.cursor/plugins/local/blackhole/skills/blackhole/SKILL.md');
    expect(readFileSync(localSkill, 'utf8')).toContain('blackhole');
    expect(lstatSync(join(home, '.cursor/plugins/local/blackhole/skills')).isSymbolicLink()).toBe(
      false,
    );
  });
});
