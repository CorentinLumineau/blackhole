import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from './lib/build/paths.ts';
import { parseTools } from './run-context.ts';
import { withTempDir } from './lib/test-fixtures.ts';

const cli = path.join(root, 'scripts', 'run-context.ts');
// A bare environment so the host's own CLAUDECODE/GH_TOKEN never leak into the result.
const run = (args: string[], cwd: string, env: Record<string, string> = {}) =>
  spawnSync('bun', ['run', cli, ...args], { cwd, encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', ...env } });

describe('parseTools', () => {
  test('accepts known tools and rejects unknown ones by name', () => {
    expect(parseTools('agent, workflow')).toEqual(['agent', 'workflow']);
    expect(() => parseTools('agent,teleport')).toThrow(/teleport/);
  });
});

describe('run-context CLI', () => {
  test('writes .blackhole/run-context.json in the working directory and exits 0 when nothing is missing', () => {
    withTempDir('run-context-cli', (dir) => {
      const res = run(['--tools', 'agent,background-agents,ask-decision,github-mcp'], dir, {
        CLAUDECODE: '1',
        CLAUDE_CODE_PROJECTS_SESSION: '1',
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('pattern P');
      const record = JSON.parse(fs.readFileSync(path.join(dir, '.blackhole', 'run-context.json'), 'utf-8'));
      expect(record.route.question_channel).toBe('ask-decision');
      expect(record.context.surface).toEqual({ value: 'project-thread', source: 'env' });
      expect(fs.existsSync(path.join(dir, '.blackhole', 'run-context.json.tmp'))).toBe(false);
    });
  });

  test('exits 1 and names each missing capability', () => {
    withTempDir('run-context-cli', (dir) => {
      const res = run(['--tools', '', '--no-write'], dir);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('missing: host');
      expect(res.stdout).toContain('missing: fan-out');
      expect(fs.existsSync(path.join(dir, '.blackhole'))).toBe(false);
    });
  });

  test('exits 2 on an unknown tool or flag value', () => {
    withTempDir('run-context-cli', (dir) => {
      expect(run(['--tools', 'agent,teleport', '--no-write'], dir).status).toBe(2);
      expect(run(['--tools', 'agent', '--host', 'vim', '--no-write'], dir).status).toBe(2);
    });
  });
});

describe('run-context CLI usage_budget wiring', () => {
  const TOOLS = 'agent,background-agents,ask-decision,github-mcp';
  const ENV = { CLAUDECODE: '1', CLAUDE_CODE_PROJECTS_SESSION: '1' };
  const WARN = 'warn: usage:';
  const withConfig = (dir: string, content: string | null, sub = '.blackhole') => {
    if (content === null) return;
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    fs.writeFileSync(path.join(dir, sub, 'config.json'), content);
  };

  test('enabled without usage-probe warns on stdout and in the written route, and still exits 0', () => {
    withTempDir('run-context-cli', (dir) => {
      withConfig(dir, JSON.stringify({ usage_budget: { enabled: true } }));
      const res = run(['--tools', TOOLS], dir, ENV);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(WARN);
      const record = JSON.parse(fs.readFileSync(path.join(dir, '.blackhole', 'run-context.json'), 'utf-8'));
      expect(record.route.warnings.filter((w: string) => w.startsWith('usage:'))).toHaveLength(1);
      expect(record.route.missing).toEqual([]);
    });
  });

  test('enabled with usage-probe reported does not warn', () => {
    withTempDir('run-context-cli', (dir) => {
      withConfig(dir, JSON.stringify({ usage_budget: { enabled: true } }));
      expect(run(['--tools', `${TOOLS},usage-probe`], dir, ENV).stdout).not.toContain(WARN);
    });
  });

  test('disabled, absent block and no config do not warn', () => {
    for (const content of [JSON.stringify({ usage_budget: { enabled: false } }), '{}', null]) {
      withTempDir('run-context-cli', (dir) => {
        withConfig(dir, content);
        const res = run(['--tools', TOOLS], dir, ENV);
        expect(res.status).toBe(0);
        expect(res.stdout).not.toContain(WARN);
      });
    }
  });

  test('--campaign-dir decides which config.json is read', () => {
    withTempDir('run-context-cli', (dir) => {
      withConfig(dir, JSON.stringify({ usage_budget: { enabled: true } }), 'camp');
      const res = run(['--tools', TOOLS, '--campaign-dir', path.join(dir, 'camp')], dir, ENV);
      expect(res.stdout).toContain(WARN);
      expect(fs.existsSync(path.join(dir, 'camp', 'run-context.json'))).toBe(true);
    });
  });

  test('a malformed config.json warns once, treats the budget as disabled and keeps the exit code', () => {
    withTempDir('run-context-cli', (dir) => {
      withConfig(dir, '{not json');
      const res = run(['--tools', TOOLS], dir, ENV);
      expect(res.status).toBe(0);
      expect(res.stdout.match(/warn: config\.json unreadable, usage_budget treated as disabled/g)).toHaveLength(1);
      expect(res.stdout).not.toContain(WARN);
    });
  });

  test('an invalid usage_budget block is treated like an unreadable config', () => {
    withTempDir('run-context-cli', (dir) => {
      withConfig(dir, JSON.stringify({ usage_budget: { enabled: true, max_workers: 0 } }));
      const res = run(['--tools', TOOLS], dir, ENV);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('warn: config.json unreadable, usage_budget treated as disabled');
      expect(res.stdout).not.toContain(WARN);
    });
  });

  test('records the detected usage source and windows, and prints them', () => {
    withTempDir('run-context-cli', (dir) => {
      const cache = path.join(dir, 'rate-limits.json');
      const resetsAt = Math.floor(Date.now() / 1000) + 50 * 3600;
      fs.writeFileSync(cache, JSON.stringify({ rate_limits: { seven_day: { used_percentage: 21, resets_at: resetsAt } } }));
      fs.mkdirSync(path.join(dir, '.blackhole'));
      fs.writeFileSync(path.join(dir, '.blackhole', 'config.json'), JSON.stringify({ resource_policy: { pace: { cache_path: cache } } }));
      const res = run(['--tools', 'agent', '--host', 'claude'], dir);
      const record = JSON.parse(fs.readFileSync(path.join(dir, '.blackhole', 'run-context.json'), 'utf-8'));
      expect(record.usage).toEqual({ source: 'rate-limit-cache', windows: ['seven_day'], reason: null });
      expect(res.stdout).toContain('usage rate-limit-cache (seven_day)');
    });
  });

  test('cursor records no usage source with the reason', () => {
    withTempDir('run-context-cli', (dir) => {
      const res = run(['--tools', 'agent', '--host', 'cursor'], dir);
      const record = JSON.parse(fs.readFileSync(path.join(dir, '.blackhole', 'run-context.json'), 'utf-8'));
      expect(record.usage).toMatchObject({ source: 'none', windows: [] });
      expect(record.usage.reason).toContain('cursor: no readable usage source');
      expect(res.stdout).toContain('usage unavailable: cursor: no readable usage source');
    });
  });
});

describe('run-context CLI plugin version warning', () => {
  const TOOLS = 'agent,background-agents,ask-decision,github-mcp';
  const ENV = { CLAUDECODE: '1', CLAUDE_CODE_PROJECTS_SESSION: '1' };
  const WARN = /warn: blackhole \S+ is running but \S+ is installed/;
  const withHome = (version: string, body: (home: string, project: string) => void) =>
    withTempDir('run-context-home', (home) =>
      withTempDir('run-context-project', (project) => {
        fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
        fs.writeFileSync(
          path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
          JSON.stringify({ plugins: { 'blackhole@blackhole-marketplace': [{ scope: 'user', version }] } }),
        );
        body(home, project);
      }),
    );
  const recordOf = (project: string) => JSON.parse(fs.readFileSync(path.join(project, '.blackhole', 'run-context.json'), 'utf-8'));

  test('a newer installed version prints a warn line with both versions, keeps exit 0 and records plugin.behind', () => {
    withHome('999.0.0', (home, project) => {
      const res = run(['--tools', TOOLS], project, { ...ENV, HOME: home });
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(WARN);
      expect(res.stdout).toContain('999.0.0');
      expect(res.stdout).not.toContain('missing:');
      expect(recordOf(project).plugin).toMatchObject({ behind: true, newest: '999.0.0' });
    });
  });

  test('no newer version: no plugin warn line and plugin.behind is false', () => {
    withHome('0.0.1', (home, project) => {
      const res = run(['--tools', TOOLS], project, { ...ENV, HOME: home });
      expect(res.status).toBe(0);
      expect(res.stdout).not.toMatch(WARN);
      expect(recordOf(project).plugin.behind).toBe(false);
    });
  });

  test('--no-write still prints the warn line', () => {
    withHome('999.0.0', (home, project) => {
      expect(run(['--tools', TOOLS, '--no-write'], project, { ...ENV, HOME: home }).stdout).toMatch(WARN);
    });
  });
});
