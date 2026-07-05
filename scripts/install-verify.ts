import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EXPECTED_BC_AGENTS, checkCursorAgents } from './doctor.ts';

const root = path.resolve(import.meta.dirname, '..');

export type InstallStatus = 'PASS' | 'PARTIAL' | 'FAIL';

export type PlatformRow = {
  platform: string;
  status: InstallStatus;
  detail?: string;
};

function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readJsonName(filePath: string): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { name?: string };
    return typeof data.name === 'string' ? data.name : null;
  } catch {
    return null;
  }
}

function resolveSymlinkTarget(linkPath: string): string {
  const target = fs.readlinkSync(linkPath);
  return path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
}

export function findBrokenSymlinks(paths: string[]): string[] {
  const broken: string[] = [];
  for (const linkPath of paths) {
    try {
      const stat = fs.lstatSync(linkPath);
      if (!stat.isSymbolicLink()) continue;
      const resolved = resolveSymlinkTarget(linkPath);
      if (!fs.existsSync(resolved)) broken.push(`${linkPath} → ${resolved}`);
    } catch {
      // missing path is not a broken symlink
    }
  }
  return broken;
}

export function assessCursor(repoRoot: string): PlatformRow {
  const check = checkCursorAgents(repoRoot);
  const skill = path.join(repoRoot, '.cursor', 'skills', 'bc-campaign', 'SKILL.md');
  if (check.ok && pathExists(skill)) {
    return { platform: 'Cursor', status: 'PASS' };
  }
  if (!check.ok) {
    return {
      platform: 'Cursor',
      status: 'FAIL',
      detail: check.detail ?? 'run `bun run build`',
    };
  }
  return { platform: 'Cursor', status: 'PARTIAL', detail: 'agents ok; missing .cursor/skills/bc-campaign/SKILL.md' };
}

export function assessClaude(repoRoot: string): PlatformRow {
  const agentsDir = path.join(repoRoot, '.claude', 'agents');
  const pluginJson = path.join(repoRoot, '.claude-plugin', 'plugin.json');
  const agentsOk =
    pathExists(agentsDir) &&
    EXPECTED_BC_AGENTS.every((name) => pathExists(path.join(agentsDir, name)));
  const pluginName = pathExists(pluginJson) ? readJsonName(pluginJson) : null;

  if (agentsOk && pluginName === 'bc-campaign') return { platform: 'Claude', status: 'PASS' };
  if (!agentsOk) {
    return { platform: 'Claude', status: 'FAIL', detail: 'missing .claude/agents — run `bun run build`' };
  }
  return { platform: 'Claude', status: 'PARTIAL', detail: 'agents present; plugin manifest missing or wrong name' };
}

export function assessGemini(repoRoot: string): PlatformRow {
  const distPlugin = path.join(repoRoot, 'plugins', 'backlog-campaign', 'plugin.json');
  const buildPlugin = path.join(repoRoot, '.agents', 'build', 'plugin.json');
  const distName = pathExists(distPlugin) ? readJsonName(distPlugin) : null;
  const buildName = pathExists(buildPlugin) ? readJsonName(buildPlugin) : null;

  if (distName === 'bc-campaign') return { platform: 'Gemini', status: 'PASS', detail: 'plugins/backlog-campaign/' };
  if (buildName === 'bc-campaign') {
    return { platform: 'Gemini', status: 'PARTIAL', detail: '.agents/build/ only — run `bun run build --gemini` for distribution bundle' };
  }
  return { platform: 'Gemini', status: 'FAIL', detail: 'run `bun run build --gemini`' };
}

export function assessCodex(repoRoot: string): PlatformRow {
  const agentsDir = path.join(repoRoot, 'codex-agents');
  const skill = path.join(repoRoot, 'codex-skills', 'bc-campaign', 'SKILL.md');
  const pluginJson = path.join(repoRoot, '.codex-plugin', 'plugin.json');

  const yamlCount = pathExists(agentsDir)
    ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.yaml')).length
    : 0;
  const pluginName = pathExists(pluginJson) ? readJsonName(pluginJson) : null;

  if (yamlCount >= 5 && pathExists(skill) && pluginName === 'bc-campaign') {
    return { platform: 'Codex', status: 'PASS' };
  }
  if (yamlCount < 5 || !pathExists(skill)) {
    return { platform: 'Codex', status: 'FAIL', detail: 'missing codex build outputs — run `bun run build`' };
  }
  return { platform: 'Codex', status: 'PARTIAL', detail: 'agents/skill ok; .codex-plugin manifest incomplete' };
}

export function assessSkillsShRepo(repoRoot: string): PlatformRow {
  const rootSkill = path.join(repoRoot, 'SKILL.md');
  const skillDir = path.join(repoRoot, 'skills', 'bc-campaign', 'SKILL.md');
  if (pathExists(rootSkill) && pathExists(skillDir)) {
    return { platform: 'skills.sh (repo)', status: 'PASS' };
  }
  return { platform: 'skills.sh (repo)', status: 'FAIL', detail: 'run `bun run build`' };
}

export function assessGlobalAgentsSkill(homeDir: string): PlatformRow {
  const bcSkill = path.join(homeDir, '.agents', 'skills', 'bc-campaign');
  const stale = path.join(homeDir, '.agents', 'skills', 'backlog-campaign');
  if (pathExists(bcSkill)) return { platform: '~/.agents/skills/', status: 'PASS', detail: 'bc-campaign' };
  if (pathExists(stale)) {
    return {
      platform: '~/.agents/skills/',
      status: 'PARTIAL',
      detail: 'stale backlog-campaign skill — migrate to bc-campaign',
    };
  }
  return {
    platform: '~/.agents/skills/',
    status: 'PARTIAL',
    detail: 'bc-campaign not installed globally (optional)',
  };
}

export function assessSkillsShGlobal(homeDir: string): PlatformRow {
  const globalSkill = path.join(homeDir, '.agents', 'skills', 'bc-campaign', 'SKILL.md');
  if (pathExists(globalSkill)) return { platform: 'skills.sh global', status: 'PASS' };
  return {
    platform: 'skills.sh global',
    status: 'PARTIAL',
    detail: 'not installed — `npx skills add … --skill bc-campaign -g -y`',
  };
}

export function assessBrokenSymlinks(homeDir: string, repoRoot: string): PlatformRow {
  const candidates = [
    path.join(homeDir, '.gemini', 'config', 'plugins', 'backlog-campaign'),
    path.join(homeDir, '.gemini', 'config', 'plugins', 'bc-campaign'),
    path.join(repoRoot, '.agents', 'plugins', 'backlog-campaign'),
    path.join(repoRoot, '.agents', 'plugins', 'bc-campaign'),
  ];
  const broken = findBrokenSymlinks(candidates);
  if (broken.length === 0) return { platform: 'Broken symlinks', status: 'PASS' };
  return {
    platform: 'Broken symlinks',
    status: 'FAIL',
    detail: broken.join('; '),
  };
}

export function buildInstallMatrix(repoRoot: string = root, homeDir: string = os.homedir()): PlatformRow[] {
  return [
    assessCursor(repoRoot),
    assessClaude(repoRoot),
    assessGemini(repoRoot),
    assessCodex(repoRoot),
    assessSkillsShRepo(repoRoot),
    assessSkillsShGlobal(homeDir),
    assessGlobalAgentsSkill(homeDir),
    assessBrokenSymlinks(homeDir, repoRoot),
  ];
}

export function formatInstallMatrix(rows: PlatformRow[]): string {
  const lines = ['Platform matrix:', ''];
  lines.push('| Platform | Status | Detail |');
  lines.push('|----------|--------|--------|');
  for (const row of rows) {
    const detail = (row.detail ?? '—').replace(/\|/g, '\\|');
    lines.push(`| ${row.platform} | ${row.status} | ${detail} |`);
  }
  return lines.join('\n');
}

export function exitCodeFromMatrix(rows: PlatformRow[]): number {
  return rows.some((r) => r.status === 'FAIL') ? 1 : 0;
}

function main(): void {
  console.log('bc-campaign install:verify\n');
  const rows = buildInstallMatrix();
  console.log(formatInstallMatrix(rows));
  console.log('');
  const fails = rows.filter((r) => r.status === 'FAIL').length;
  const partial = rows.filter((r) => r.status === 'PARTIAL').length;
  console.log(`Summary: ${rows.length - fails - partial} PASS · ${partial} PARTIAL · ${fails} FAIL`);
  process.exit(exitCodeFromMatrix(rows));
}

if (import.meta.main) {
  main();
}
