import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(import.meta.dirname, '..');
const DEFAULT_CONFIG_PATH = '.bc-campaign/config.json';

export type CheckSeverity = 'BLOCK' | 'WARN';
export type DoctorCheck = { id: string; severity: CheckSeverity; ok: boolean; detail?: string };

export const EXPECTED_BC_AGENTS = [
  'bc-coordinator.md',
  'bc-orchestrator.md',
  'bc-planner.md',
  'bc-implementer.md',
  'bc-reviewer.md',
] as const;

const REQUIRED_CONFIG_KEYS = ['repo', 'target_branch', 'forge'] as const;

export function validateConfigJson(content: string): { ok: boolean; detail?: string } {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { ok: false, detail: 'invalid JSON' };
  }

  for (const key of REQUIRED_CONFIG_KEYS) {
    if (!config[key] || typeof config[key] !== 'string') {
      return { ok: false, detail: `missing or invalid ${key}` };
    }
  }

  return { ok: true };
}

export function checkCursorAgents(repoRoot: string): DoctorCheck {
  const agentsDir = path.join(repoRoot, '.cursor', 'agents');
  if (!fs.existsSync(agentsDir)) {
    return {
      id: 'D-AGENTS-01',
      severity: 'BLOCK',
      ok: false,
      detail: '.cursor/agents/ missing — run `bun run build`',
    };
  }

  const bcAgents = fs
    .readdirSync(agentsDir)
    .filter((f) => f.startsWith('bc-') && f.endsWith('.md'));

  const missing = EXPECTED_BC_AGENTS.filter((name) => !bcAgents.includes(name));
  if (missing.length > 0) {
    return {
      id: 'D-AGENTS-01',
      severity: 'BLOCK',
      ok: false,
      detail: `expected 5 bc-*.md agents, found ${bcAgents.length} — run \`bun run build\` (missing: ${missing.join(', ')})`,
    };
  }

  return { id: 'D-AGENTS-01', severity: 'BLOCK', ok: true };
}

export function shouldRunGhAuth(config: Record<string, unknown>): boolean {
  if (config.auto_sync === false) return false;
  return true;
}

export function checkStaleGlobalSkill(homeDir: string): DoctorCheck {
  const stalePath = path.join(homeDir, '.agents', 'skills', 'backlog-campaign');
  if (fs.existsSync(stalePath)) {
    return {
      id: 'D-SKILL-01',
      severity: 'WARN',
      ok: false,
      detail: `stale skill at ${stalePath} — remove or migrate to bc-campaign`,
    };
  }
  return { id: 'D-SKILL-01', severity: 'WARN', ok: true };
}

function resolveSymlinkTarget(linkPath: string): string {
  const target = fs.readlinkSync(linkPath);
  return path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
}

export function checkGeminiSymlinks(paths: string[]): DoctorCheck[] {
  return paths.map((linkPath, index) => {
    const id = index === 0 ? 'D-GEMINI-01' : 'D-GEMINI-02';

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      return { id, severity: 'WARN', ok: true };
    }

    if (!stat.isSymbolicLink()) {
      return { id, severity: 'WARN', ok: true };
    }

    const resolved = resolveSymlinkTarget(linkPath);
    if (fs.existsSync(resolved)) {
      return { id, severity: 'WARN', ok: true };
    }

    return {
      id,
      severity: 'WARN',
      ok: false,
      detail: `broken symlink ${linkPath} → ${resolved}`,
    };
  });
}

export function exitCodeFromChecks(checks: DoctorCheck[]): number {
  const blockFailed = checks.some((c) => c.severity === 'BLOCK' && !c.ok);
  return blockFailed ? 1 : 0;
}

function resolveConfigPath(repoRoot: string): string {
  if (process.env.CAMPAIGN_CONFIG) {
    return process.env.CAMPAIGN_CONFIG;
  }
  return path.join(repoRoot, DEFAULT_CONFIG_PATH);
}

function runVerify(repoRoot: string): DoctorCheck {
  if (process.env.DOCTOR_SKIP_VERIFY === '1') {
    return { id: 'D-VERIFY-01', severity: 'BLOCK', ok: true };
  }

  const result = spawnSync('bun', ['run', 'verify'], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    const detail =
      result.stderr?.trim() || result.stdout?.trim() || `verify exited with code ${result.status}`;
    return { id: 'D-VERIFY-01', severity: 'BLOCK', ok: false, detail };
  }

  return { id: 'D-VERIFY-01', severity: 'BLOCK', ok: true };
}

function checkConfigExists(configPath: string): DoctorCheck {
  if (!fs.existsSync(configPath)) {
    return {
      id: 'D-CONFIG-01',
      severity: 'BLOCK',
      ok: false,
      detail: `${configPath} not found`,
    };
  }
  return { id: 'D-CONFIG-01', severity: 'BLOCK', ok: true };
}

function checkConfigValid(configPath: string): DoctorCheck {
  const content = fs.readFileSync(configPath, 'utf-8');
  const result = validateConfigJson(content);
  if (!result.ok) {
    return {
      id: 'D-CONFIG-02',
      severity: 'BLOCK',
      ok: false,
      detail: result.detail,
    };
  }
  return { id: 'D-CONFIG-02', severity: 'BLOCK', ok: true };
}

function runGhAuth(): DoctorCheck {
  const gh = spawnSync('gh', ['auth', 'status'], {
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (gh.error && (gh.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return {
      id: 'D-GH-01',
      severity: 'BLOCK',
      ok: false,
      detail: 'GitHub CLI not found — install GitHub CLI and run `gh auth login`',
    };
  }

  if (gh.status !== 0) {
    const detail =
      gh.stderr?.trim() || gh.stdout?.trim() || 'gh auth status failed — run `gh auth login`';
    return { id: 'D-GH-01', severity: 'BLOCK', ok: false, detail };
  }

  return { id: 'D-GH-01', severity: 'BLOCK', ok: true };
}

function printCheck(check: DoctorCheck): void {
  const warnIcon = check.ok ? '✓' : '⚠';
  const blockIcon = check.ok ? '✓' : '✗';
  const displayIcon = check.severity === 'WARN' ? warnIcon : blockIcon;
  console.log(`  ${displayIcon} ${check.id}${check.detail ? ` — ${check.detail}` : ''}`);
}

export function runDoctorChecks(repoRoot: string = root): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  checks.push(runVerify(repoRoot));

  const configPath = resolveConfigPath(repoRoot);
  checks.push(checkConfigExists(configPath));

  if (checks[checks.length - 1].ok) {
    checks.push(checkConfigValid(configPath));

    if (checks[checks.length - 1].ok) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      if (shouldRunGhAuth(config)) {
        checks.push(runGhAuth());
      }
    }
  }

  checks.push(checkCursorAgents(repoRoot));

  const homeDir = os.homedir();
  checks.push(checkStaleGlobalSkill(homeDir));

  const geminiPaths = [
    path.join(homeDir, '.gemini', 'config', 'plugins', 'backlog-campaign'),
    path.join(repoRoot, '.agents', 'plugins', 'backlog-campaign'),
  ];
  checks.push(...checkGeminiSymlinks(geminiPaths));

  return checks;
}

function main(): void {
  console.log('bc-campaign doctor\n');

  const checks = runDoctorChecks();
  let blockPassed = 0;
  let blockTotal = 0;
  let warnCount = 0;

  for (const check of checks) {
    printCheck(check);
    if (check.severity === 'BLOCK') {
      blockTotal++;
      if (check.ok) blockPassed++;
    } else if (!check.ok) {
      warnCount++;
    }
  }

  console.log(`\n${blockPassed} BLOCK passed, ${warnCount} WARN`);

  process.exit(exitCodeFromChecks(checks));
}

if (import.meta.main) {
  main();
}
