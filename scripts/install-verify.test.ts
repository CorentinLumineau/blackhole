import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EXPECTED_BC_AGENTS } from './doctor';
import {
  checkAgentsSkillsDirRow,
  checkBrokenSymlinksRow,
  checkClaudeRow,
  checkCodexRow,
  checkCursorRow,
  checkGeminiRow,
  checkSkillsShGlobalRow,
  exitCodeFromInstallChecks,
  type InstallCheck,
} from './install-verify';

const CODEX_ARTIFACTS = ['.codex-plugin', 'codex-skills', 'codex-agents', 'codex-marketplace.json'];

function writeCodexArtifact(repoRoot: string, name: string): void {
  const target = path.join(repoRoot, name);
  if (name.endsWith('.json')) {
    fs.writeFileSync(target, '{}');
  } else {
    fs.mkdirSync(target, { recursive: true });
  }
}

describe('checkCursorRow', () => {
  test('PASS when all five bc agents present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-cursor-'));
    const agentsDir = path.join(root, '.cursor', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const name of EXPECTED_BC_AGENTS) {
      fs.writeFileSync(path.join(agentsDir, name), '# agent\n');
    }

    const check = checkCursorRow(root);
    expect(check.status).toBe('PASS');
    expect(check.platform).toBe('Cursor');
  });

  test('PARTIAL when 1-4 of 5 agents present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-cursor-'));
    const agentsDir = path.join(root, '.cursor', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const name of EXPECTED_BC_AGENTS.slice(0, 3)) {
      fs.writeFileSync(path.join(agentsDir, name), '# agent\n');
    }

    const check = checkCursorRow(root);
    expect(check.status).toBe('PARTIAL');
  });

  test('FAIL when agents directory missing (0/5)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-cursor-'));
    const check = checkCursorRow(root);
    expect(check.status).toBe('FAIL');
  });
});

describe('checkClaudeRow', () => {
  test('PASS when both marketplace.json and an agent .md file present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-claude-'));
    fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), '{}');
    fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'agents', 'coordinator.md'), '# agent\n');

    const check = checkClaudeRow(root);
    expect(check.status).toBe('PASS');
    expect(check.detail).toMatch(/repo-local/);
  });

  test('PARTIAL when only marketplace.json present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-claude-'));
    fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), '{}');

    const check = checkClaudeRow(root);
    expect(check.status).toBe('PARTIAL');
  });

  test('PARTIAL when only an agent .md file present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-claude-'));
    fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'agents', 'reviewer.md'), '# agent\n');

    const check = checkClaudeRow(root);
    expect(check.status).toBe('PARTIAL');
  });

  test('FAIL when neither artifact present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-claude-'));
    const check = checkClaudeRow(root);
    expect(check.status).toBe('FAIL');
  });
});

describe('checkGeminiRow', () => {
  test('PASS when current-name symlink is valid', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-gemini-'));
    const pluginsDir = path.join(home, '.gemini', 'config', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const target = path.join(home, 'target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(pluginsDir, 'blackhole'));

    const check = checkGeminiRow(home);
    expect(check.status).toBe('PASS');
  });

  test('PARTIAL when only bc-campaign-generation legacy-name symlink is valid', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-gemini-'));
    const pluginsDir = path.join(home, '.gemini', 'config', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const target = path.join(home, 'target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(pluginsDir, 'bc-campaign'));

    const check = checkGeminiRow(home);
    expect(check.status).toBe('PARTIAL');
  });

  test('PARTIAL when only backlog-campaign-generation legacy-name symlink is valid', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-gemini-'));
    const pluginsDir = path.join(home, '.gemini', 'config', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const target = path.join(home, 'target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(pluginsDir, 'backlog-campaign'));

    const check = checkGeminiRow(home);
    expect(check.status).toBe('PARTIAL');
  });

  test('FAIL when a broken symlink is present', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-gemini-'));
    const pluginsDir = path.join(home, '.gemini', 'config', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.symlinkSync(path.join(home, 'missing-target'), path.join(pluginsDir, 'blackhole'));

    const check = checkGeminiRow(home);
    expect(check.status).toBe('FAIL');
  });

  test('PASS (not installed) when neither present', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-gemini-'));
    const check = checkGeminiRow(home);
    expect(check.status).toBe('PASS');
  });
});

describe('checkCodexRow', () => {
  test('PASS when all 4 committed artifacts present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-codex-'));
    for (const name of CODEX_ARTIFACTS) writeCodexArtifact(root, name);

    const check = checkCodexRow(root);
    expect(check.status).toBe('PASS');
  });

  test('PARTIAL when some artifacts present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-codex-'));
    writeCodexArtifact(root, '.codex-plugin');
    writeCodexArtifact(root, 'codex-marketplace.json');

    const check = checkCodexRow(root);
    expect(check.status).toBe('PARTIAL');
  });

  test('FAIL when no artifacts present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-codex-'));
    const check = checkCodexRow(root);
    expect(check.status).toBe('FAIL');
  });
});

describe('checkSkillsShGlobalRow', () => {
  test('PASS when current-name dir present', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-skillssh-'));
    fs.mkdirSync(path.join(home, '.agents', 'skills', 'blackhole'), { recursive: true });

    const check = checkSkillsShGlobalRow(home);
    expect(check.status).toBe('PASS');
  });

  test('PARTIAL when only bc-campaign-generation legacy-name dir present', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-skillssh-'));
    fs.mkdirSync(path.join(home, '.agents', 'skills', 'bc-campaign'), { recursive: true });

    const check = checkSkillsShGlobalRow(home);
    expect(check.status).toBe('PARTIAL');
  });

  test('PARTIAL when only backlog-campaign-generation legacy-name dir present', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-skillssh-'));
    fs.mkdirSync(path.join(home, '.agents', 'skills', 'backlog-campaign'), { recursive: true });

    const check = checkSkillsShGlobalRow(home);
    expect(check.status).toBe('PARTIAL');
  });

  test('PASS when neither present', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-skillssh-'));
    const check = checkSkillsShGlobalRow(home);
    expect(check.status).toBe('PASS');
  });
});

describe('checkAgentsSkillsDirRow', () => {
  test('PASS when dir does not exist', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-dir-'));
    const check = checkAgentsSkillsDirRow(home);
    expect(check.status).toBe('PASS');
  });

  test('PASS when dir exists and is empty', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-dir-'));
    fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });

    const check = checkAgentsSkillsDirRow(home);
    expect(check.status).toBe('PASS');
  });

  test('PASS when dir exists and is populated', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-dir-'));
    const dir = path.join(home, '.agents', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'some-skill'));

    const check = checkAgentsSkillsDirRow(home);
    expect(check.status).toBe('PASS');
  });

  test.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'FAIL when dir exists but a permission error occurs on read',
    () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-dir-'));
      const dir = path.join(home, '.agents', 'skills');
      fs.mkdirSync(dir, { recursive: true });
      fs.chmodSync(dir, 0o000);

      try {
        const check = checkAgentsSkillsDirRow(home);
        expect(check.status).toBe('FAIL');
      } finally {
        fs.chmodSync(dir, 0o755);
      }
    },
  );
});

describe('checkBrokenSymlinksRow', () => {
  test('PASS when zero broken symlinks across all tracked paths', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-broken-'));
    const scanDir = path.join(base, 'plugins');
    fs.mkdirSync(scanDir, { recursive: true });
    const target = path.join(base, 'target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(scanDir, 'bc-campaign'));

    const check = checkBrokenSymlinksRow([scanDir]);
    expect(check.status).toBe('PASS');
  });

  test('PARTIAL when a broken symlink is an unrelated adjacent entry', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-broken-'));
    const scanDir = path.join(base, 'plugins');
    fs.mkdirSync(scanDir, { recursive: true });
    fs.symlinkSync(path.join(base, 'missing'), path.join(scanDir, 'some-other-plugin'));

    const check = checkBrokenSymlinksRow([scanDir]);
    expect(check.status).toBe('PARTIAL');
  });

  test('FAIL when a broken symlink is among bc-campaign own tracked paths', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install-verify-broken-'));
    const scanDir = path.join(base, 'plugins');
    fs.mkdirSync(scanDir, { recursive: true });
    fs.symlinkSync(path.join(base, 'missing'), path.join(scanDir, 'bc-campaign'));

    const check = checkBrokenSymlinksRow([scanDir]);
    expect(check.status).toBe('FAIL');
  });

  test('PASS when scan directories do not exist', () => {
    const check = checkBrokenSymlinksRow(['/nonexistent/plugins', '/nonexistent/skills']);
    expect(check.status).toBe('PASS');
  });
});

describe('exitCodeFromInstallChecks', () => {
  test('exit 1 when any row is FAIL', () => {
    const checks: InstallCheck[] = [
      { platform: 'Cursor', status: 'PASS' },
      { platform: 'Gemini', status: 'FAIL' },
    ];
    expect(exitCodeFromInstallChecks(checks)).toBe(1);
  });

  test('exit 0 when all rows are PASS or PARTIAL', () => {
    const checks: InstallCheck[] = [
      { platform: 'Cursor', status: 'PASS' },
      { platform: 'Gemini', status: 'PARTIAL' },
    ];
    expect(exitCodeFromInstallChecks(checks)).toBe(0);
  });
});
