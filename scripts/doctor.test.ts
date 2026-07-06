import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EXPECTED_BC_AGENTS,
  checkCursorAgents,
  checkGeminiSymlinks,
  checkStaleGlobalSkill,
  exitCodeFromChecks,
  shouldRunGhAuth,
  validateConfigJson,
  type DoctorCheck,
} from './doctor';

const validConfig = JSON.stringify({
  repo: 'owner/repo',
  target_branch: 'main',
  forge: 'github',
});

describe('validateConfigJson', () => {
  test('accepts valid fixture shape', () => {
    const result = validateConfigJson(validConfig);
    expect(result.ok).toBe(true);
  });

  test('rejects invalid JSON', () => {
    const result = validateConfigJson('{ not json');
    expect(result.ok).toBe(false);
    expect(result.detail).toBeDefined();
  });

  test('rejects missing required key', () => {
    const result = validateConfigJson(JSON.stringify({ repo: 'a/b', target_branch: 'main' }));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/forge/);
  });

  test('rejects empty required string', () => {
    const result = validateConfigJson(
      JSON.stringify({ repo: '', target_branch: 'main', forge: 'github' }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/repo/);
  });
});

describe('checkCursorAgents', () => {
  test('passes when all five bc agents present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-agents-'));
    const agentsDir = path.join(root, '.cursor', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const name of EXPECTED_BC_AGENTS) {
      fs.writeFileSync(path.join(agentsDir, name), '# agent\n');
    }

    const check = checkCursorAgents(root);
    expect(check.ok).toBe(true);
    expect(check.id).toBe('D-AGENTS-01');
  });

  test('fails when only four agents present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-agents-'));
    const agentsDir = path.join(root, '.cursor', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const name of EXPECTED_BC_AGENTS.slice(0, 4)) {
      fs.writeFileSync(path.join(agentsDir, name), '# agent\n');
    }

    const check = checkCursorAgents(root);
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/build/);
  });

  test('fails when agents directory missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-agents-'));
    const check = checkCursorAgents(root);
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/build/);
  });
});

describe('shouldRunGhAuth', () => {
  test('true when auto_sync is true', () => {
    expect(shouldRunGhAuth({ auto_sync: true })).toBe(true);
  });

  test('false when auto_sync is false', () => {
    expect(shouldRunGhAuth({ auto_sync: false })).toBe(false);
  });

  test('true when auto_sync absent (default)', () => {
    expect(shouldRunGhAuth({})).toBe(true);
  });
});

describe('checkStaleGlobalSkill', () => {
  test('ok when stale skill path absent', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-home-'));
    const check = checkStaleGlobalSkill(home);
    expect(check.ok).toBe(true);
    expect(check.severity).toBe('WARN');
    expect(check.id).toBe('D-SKILL-01');
  });

  test('warn when stale skill path (backlog-campaign generation) exists', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-home-'));
    const skillDir = path.join(home, '.agents', 'skills', 'backlog-campaign');
    fs.mkdirSync(skillDir, { recursive: true });

    const check = checkStaleGlobalSkill(home);
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('WARN');
    expect(check.detail).toMatch(/blackhole/);
  });

  test('warn when stale skill path (bc-campaign generation) exists', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-home-'));
    const skillDir = path.join(home, '.agents', 'skills', 'bc-campaign');
    fs.mkdirSync(skillDir, { recursive: true });

    const check = checkStaleGlobalSkill(home);
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('WARN');
    expect(check.detail).toMatch(/blackhole/);
  });
});

describe('checkGeminiSymlinks', () => {
  test('ok when paths absent', () => {
    const checks = checkGeminiSymlinks(['/nonexistent/a', '/nonexistent/b']);
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  test('ok when symlink target exists', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-symlink-'));
    const target = path.join(base, 'target');
    fs.mkdirSync(target);
    const link = path.join(base, 'link');
    fs.symlinkSync(target, link);

    const checks = checkGeminiSymlinks([link]);
    expect(checks[0].ok).toBe(true);
    expect(checks[0].severity).toBe('WARN');
  });

  test('warn when symlink target missing', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-symlink-'));
    const link = path.join(base, 'broken-link');
    fs.symlinkSync(path.join(base, 'missing-target'), link);

    const checks = checkGeminiSymlinks([link]);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].severity).toBe('WARN');
    expect(checks[0].detail).toMatch(/broken|missing/i);
  });

  test('ok for regular file (not a symlink)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-symlink-'));
    const file = path.join(base, 'regular');
    fs.writeFileSync(file, 'content');

    const checks = checkGeminiSymlinks([file]);
    expect(checks[0].ok).toBe(true);
  });

  test('assigns a distinct D-GEMINI id to every path, not just the first two', () => {
    const checks = checkGeminiSymlinks([
      '/nonexistent/a',
      '/nonexistent/b',
      '/nonexistent/c',
      '/nonexistent/d',
    ]);
    expect(checks.map((c) => c.id)).toEqual([
      'D-GEMINI-01',
      'D-GEMINI-02',
      'D-GEMINI-03',
      'D-GEMINI-04',
    ]);
  });
});

describe('exitCodeFromChecks', () => {
  test('returns 1 when any BLOCK check fails', () => {
    const checks: DoctorCheck[] = [
      { id: 'D-CONFIG-01', severity: 'BLOCK', ok: true },
      { id: 'D-AGENTS-01', severity: 'BLOCK', ok: false },
    ];
    expect(exitCodeFromChecks(checks)).toBe(1);
  });

  test('returns 0 when only WARN checks fail', () => {
    const checks: DoctorCheck[] = [
      { id: 'D-CONFIG-01', severity: 'BLOCK', ok: true },
      { id: 'D-SKILL-01', severity: 'WARN', ok: false },
    ];
    expect(exitCodeFromChecks(checks)).toBe(0);
  });

  test('returns 0 when all checks pass', () => {
    const checks: DoctorCheck[] = [
      { id: 'D-CONFIG-01', severity: 'BLOCK', ok: true },
      { id: 'D-SKILL-01', severity: 'WARN', ok: true },
    ];
    expect(exitCodeFromChecks(checks)).toBe(0);
  });
});
