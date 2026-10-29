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
