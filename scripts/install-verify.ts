import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkCursorAgents,
  checkGeminiSymlinks,
  checkStaleGlobalSkill,
  resolveSymlinkTarget,
} from './doctor';
import { AGENT_MD_FILES } from './build';

const root = path.resolve(import.meta.dirname, '..');

export type InstallStatus = 'PASS' | 'PARTIAL' | 'FAIL';
export type InstallCheck = { platform: string; status: InstallStatus; detail?: string };

const CODEX_ARTIFACTS = [
  '.codex-plugin',
  'codex-skills',
  'codex-agents',
  'codex-marketplace.json',
] as const;

const OWN_SYMLINK_NAME_PATTERN = /blackhole|bc-campaign|backlog-campaign/;

export function checkCursorRow(repoRoot: string): InstallCheck {
  const check = checkCursorAgents(repoRoot);
  if (check.ok) return { platform: 'Cursor', status: 'PASS' };

  const agentsDir = path.join(repoRoot, '.cursor', 'agents');
  if (!fs.existsSync(agentsDir)) {
    return { platform: 'Cursor', status: 'FAIL', detail: check.detail };
  }
  return { platform: 'Cursor', status: 'PARTIAL', detail: check.detail };
}

export function checkClaudeRow(repoRoot: string): InstallCheck {
  const detail = 'repo-local build-artifact proxy — not a true workstation-wide Claude install check';
  const hasMarketplace = fs.existsSync(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));

  const agentsDir = path.join(repoRoot, '.claude', 'agents');
  const hasBcAgent =
    fs.existsSync(agentsDir) &&
    fs.readdirSync(agentsDir).some((f) => AGENT_MD_FILES.has(f));

  if (hasMarketplace && hasBcAgent) return { platform: 'Claude', status: 'PASS', detail };
  if (hasMarketplace || hasBcAgent) return { platform: 'Claude', status: 'PARTIAL', detail };
  return { platform: 'Claude', status: 'FAIL', detail };
}

export function checkGeminiRow(homeDir: string): InstallCheck {
  const currentPath = path.join(homeDir, '.gemini', 'config', 'plugins', 'blackhole');
  const legacyPathBc = path.join(homeDir, '.gemini', 'config', 'plugins', 'bc-campaign');
  const legacyPathBacklog = path.join(homeDir, '.gemini', 'config', 'plugins', 'backlog-campaign');
  const [currentCheck, legacyBcCheck, legacyBacklogCheck] = checkGeminiSymlinks([
    currentPath,
    legacyPathBc,
    legacyPathBacklog,
  ]);

  if (!currentCheck.ok) return { platform: 'Gemini', status: 'FAIL', detail: currentCheck.detail };
  if (!legacyBcCheck.ok) return { platform: 'Gemini', status: 'FAIL', detail: legacyBcCheck.detail };
  if (!legacyBacklogCheck.ok) {
    return { platform: 'Gemini', status: 'FAIL', detail: legacyBacklogCheck.detail };
  }

  if (fs.existsSync(currentPath)) return { platform: 'Gemini', status: 'PASS' };
  if (fs.existsSync(legacyPathBc)) {
    return {
      platform: 'Gemini',
      status: 'PARTIAL',
      detail: `legacy path ${legacyPathBc} — migrate to blackhole naming`,
    };
  }
  if (fs.existsSync(legacyPathBacklog)) {
    return {
      platform: 'Gemini',
      status: 'PARTIAL',
      detail: `legacy path ${legacyPathBacklog} — migrate to blackhole naming`,
    };
  }
  return { platform: 'Gemini', status: 'PASS', detail: 'not installed' };
}

export function checkCodexRow(repoRoot: string): InstallCheck {
  const present = CODEX_ARTIFACTS.filter((name) => fs.existsSync(path.join(repoRoot, name)));

  if (present.length === CODEX_ARTIFACTS.length) return { platform: 'Codex', status: 'PASS' };
  if (present.length === 0) {
    return {
      platform: 'Codex',
      status: 'FAIL',
      detail: 'no Codex artifacts committed — run `bun run build`',
    };
  }
  return {
    platform: 'Codex',
    status: 'PARTIAL',
    detail: `${present.length}/${CODEX_ARTIFACTS.length} Codex artifacts present`,
  };
}

export function checkSkillsShGlobalRow(homeDir: string): InstallCheck {
  const currentDir = path.join(homeDir, '.agents', 'skills', 'blackhole');
  if (fs.existsSync(currentDir)) return { platform: 'skills.sh (global)', status: 'PASS' };

  const legacyCheck = checkStaleGlobalSkill(homeDir);
  if (!legacyCheck.ok) {
    return { platform: 'skills.sh (global)', status: 'PARTIAL', detail: legacyCheck.detail };
  }
  return { platform: 'skills.sh (global)', status: 'PASS', detail: 'not installed' };
}

export function checkAgentsSkillsDirRow(homeDir: string): InstallCheck {
  const dir = path.join(homeDir, '.agents', 'skills');
  if (!fs.existsSync(dir)) {
    return { platform: '~/.agents/skills/', status: 'PASS', detail: 'not present' };
  }

  try {
    fs.readdirSync(dir);
    return { platform: '~/.agents/skills/', status: 'PASS' };
  } catch (err) {
    return {
      platform: '~/.agents/skills/',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : 'permission error reading directory',
    };
  }
}

export function checkBrokenSymlinksRow(scanDirs: string[]): InstallCheck {
  const ownBroken: string[] = [];
  const otherBroken: string[] = [];

  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir)) {
      const entryPath = path.join(dir, entry);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(entryPath);
      } catch {
        continue;
      }
      if (!stat.isSymbolicLink()) continue;

      const resolved = resolveSymlinkTarget(entryPath);
      if (fs.existsSync(resolved)) continue;

      if (OWN_SYMLINK_NAME_PATTERN.test(entry)) {
        ownBroken.push(entryPath);
      } else {
        otherBroken.push(entryPath);
      }
    }
  }

  if (ownBroken.length > 0) {
    return {
      platform: 'Broken symlinks',
      status: 'FAIL',
      detail: `broken blackhole symlink(s): ${ownBroken.join(', ')}`,
    };
  }
  if (otherBroken.length > 0) {
    return {
      platform: 'Broken symlinks',
      status: 'PARTIAL',
      detail: `unrelated broken symlink(s) nearby: ${otherBroken.join(', ')}`,
    };
  }
  return { platform: 'Broken symlinks', status: 'PASS' };
}

export function runInstallChecks(repoRoot: string, homeDir: string): InstallCheck[] {
  return [
    checkCursorRow(repoRoot),
    checkClaudeRow(repoRoot),
    checkGeminiRow(homeDir),
    checkCodexRow(repoRoot),
    checkSkillsShGlobalRow(homeDir),
    checkAgentsSkillsDirRow(homeDir),
    checkBrokenSymlinksRow([
      path.join(homeDir, '.gemini', 'config', 'plugins'),
      path.join(homeDir, '.agents', 'skills'),
    ]),
  ];
}

export function exitCodeFromInstallChecks(checks: InstallCheck[]): number {
  return checks.some((c) => c.status === 'FAIL') ? 1 : 0;
}

function statusIcon(status: InstallStatus): string {
  if (status === 'PASS') return '✓';
  if (status === 'PARTIAL') return '⚠';
  return '✗';
}

function printRow(check: InstallCheck): void {
  const label = check.platform.padEnd(20);
  console.log(`  ${statusIcon(check.status)} ${label} ${check.status}${check.detail ? ` — ${check.detail}` : ''}`);
}

function main(): void {
  console.log('blackhole install:verify\n');

  const homeDir = os.homedir();
  const checks = runInstallChecks(root, homeDir);

  for (const check of checks) {
    printRow(check);
  }

  const passCount = checks.filter((c) => c.status === 'PASS').length;
  const partialCount = checks.filter((c) => c.status === 'PARTIAL').length;
  const failCount = checks.filter((c) => c.status === 'FAIL').length;

  console.log(`\n${passCount} PASS, ${partialCount} PARTIAL, ${failCount} FAIL`);

  process.exit(exitCodeFromInstallChecks(checks));
}

if (import.meta.main) {
  main();
}
