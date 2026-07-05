import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assessBrokenSymlinks,
  assessCursor,
  exitCodeFromMatrix,
  findBrokenSymlinks,
  formatInstallMatrix,
  type PlatformRow,
} from './install-verify.ts';
import { EXPECTED_BC_AGENTS } from './doctor.ts';

describe('findBrokenSymlinks', () => {
  test('reports symlink with missing target', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-'));
    const target = path.join(tmp, 'missing-target');
    const link = path.join(tmp, 'link');
    fs.symlinkSync(target, link);
    expect(findBrokenSymlinks([link])).toEqual([`${link} → ${target}`]);
  });
});

describe('assessCursor', () => {
  test('PASS when agents and skill present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-'));
    const agentsDir = path.join(tmp, '.cursor', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const name of EXPECTED_BC_AGENTS) {
      fs.writeFileSync(path.join(agentsDir, name), '# agent\n');
    }
    const skillDir = path.join(tmp, '.cursor', 'skills', 'bc-campaign');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill\n');
    expect(assessCursor(tmp).status).toBe('PASS');
  });
});

describe('formatInstallMatrix', () => {
  test('renders markdown table', () => {
    const rows: PlatformRow[] = [{ platform: 'Cursor', status: 'PASS' }];
    expect(formatInstallMatrix(rows)).toContain('| Cursor | PASS |');
  });
});

describe('exitCodeFromMatrix', () => {
  test('returns 1 when any FAIL', () => {
    expect(exitCodeFromMatrix([{ platform: 'x', status: 'FAIL' }])).toBe(1);
    expect(exitCodeFromMatrix([{ platform: 'x', status: 'PARTIAL' }])).toBe(0);
  });
});

describe('assessBrokenSymlinks', () => {
  test('PASS when no broken links in empty list paths', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-'));
    expect(assessBrokenSymlinks(os.homedir(), tmp).status).toBe('PASS');
  });
});
