import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { resolveUsageBudget } from './lib/usage-budget.ts';
import { usageSourceFor, type UsageReading } from './lib/usage-source.ts';
import { checkForgeAuthSync } from './lib/forge-doctor.ts';
import { isSleepMode } from './lib/campaign-status/pending-decisions.ts';
import { readSleepSession } from './lib/campaign-status/sleep-session.ts';
import {
  AGENT_TOOLS,
  detectRunContext,
  routeRunContext,
  type AgentTool,
  type Host,
  type Surface,
} from './lib/run-context.ts';

// Writes .blackhole/run-context.json (the context, the route, the host's usage source with the
// windows its reading shows, and whether sleep mode is on) and prints the resolved route (ADR-046). Exit 1 when the
// campaign is missing a capability it cannot start without, so bootstrap can refuse by exit code.

const USAGE =
  'Usage: bun run scripts/run-context.ts --tools <comma list> [--host claude|cursor] ' +
  '[--surface local|cloud|project-thread|headless] [--persistent-disk yes|no] [--campaign-dir <dir>] [--no-write]\n' +
  `  tools: ${AGENT_TOOLS.join(', ')}`;
const HOSTS: Host[] = ['claude', 'cursor'];
const SURFACES: Surface[] = ['local', 'cloud', 'project-thread', 'headless'];

const fail = (message: string): never => {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
};

export const parseTools = (raw: string): AgentTool[] => {
  const tools = raw.split(',').map((t) => t.trim()).filter(Boolean);
  const unknown = tools.filter((t) => !(AGENT_TOOLS as readonly string[]).includes(t));
  if (unknown.length) throw new Error(`unknown tool(s): ${unknown.join(', ')}`);
  return tools as AgentTool[];
};

type Config = { config: Record<string, unknown>; unreadable: boolean };
const readConfig = (configPath: string): Config => {
  if (!fs.existsSync(configPath)) return { config: {}, unreadable: false };
  try {
    return { config: readJsonFile(configPath, configPath) as Record<string, unknown>, unreadable: false };
  } catch {
    return { config: {}, unreadable: true };
  }
};

// An unreadable config or an invalid block must not look like a missing capability (exit 1): the
// budget counts as disabled and the run says so.
const usageBudgetEnabled = ({ config, unreadable }: Config): { enabled: boolean; unreadable: boolean } => {
  if (unreadable) return { enabled: false, unreadable };
  try {
    return { enabled: resolveUsageBudget(config).enabled, unreadable: false };
  } catch {
    return { enabled: false, unreadable: true };
  }
};

/** The host's usage source and the windows its current reading shows (usage-source.ts). */
const detectUsage = (host: Parameters<typeof usageSourceFor>[0], config: Record<string, unknown>): Omit<UsageReading, 'limits'> => {
  try {
    const { source, windows, reason } = usageSourceFor(host, config).read(Math.floor(Date.now() / 1000));
    return { source, windows, reason };
  } catch (err) {
    return { source: 'none', windows: [], reason: `usage source config invalid: ${(err as Error).message}` };
  }
};

const main = () => {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['tools', 'host', 'surface', 'persistent-disk', 'campaign-dir', 'no-write']);
  if (unknown.length) fail(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  if (typeof flags.tools !== 'string') fail('missing --tools');
  let tools: AgentTool[] = [];
  try {
    tools = parseTools(flags.tools as string);
  } catch (err) {
    fail((err as Error).message);
  }
  const host = flags.host as Host | undefined;
  if (host !== undefined && !HOSTS.includes(host)) fail(`invalid --host ${String(host)}`);
  const surface = flags.surface as Surface | undefined;
  if (surface !== undefined && !SURFACES.includes(surface)) fail(`invalid --surface ${String(surface)}`);
  const disk = flags['persistent-disk'];
  if (disk !== undefined && disk !== 'yes' && disk !== 'no') fail('invalid --persistent-disk (yes|no)');

  const context = detectRunContext(process.env, { ghAuthenticated: checkForgeAuthSync('github').channel === 'gh' }, tools, {
    host,
    surface,
    persistentDisk: disk === undefined ? undefined : disk === 'yes',
  });
  // Campaign state belongs to the project the command runs in (working directory).
  const campaignDir = path.resolve(typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole');
  const config = readConfig(path.join(campaignDir, 'config.json'));
  const budget = usageBudgetEnabled(config);
  const route = routeRunContext(context, { usageBudgetEnabled: budget.enabled });
  const usage = detectUsage(context.host.value, config.config);
  const sleepMode = { enabled: isSleepMode(config.config), since: readSleepSession(config.config).since };

  if (flags['no-write'] !== true) {
    fs.mkdirSync(campaignDir, { recursive: true });
    const target = path.join(campaignDir, 'run-context.json');
    const tmp = `${target}.tmp`;
    const record = { refreshed_at: new Date().toISOString(), context, route, usage, sleep_mode: sleepMode };
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    fs.renameSync(tmp, target);
  }

  console.log(
    `Run context: ${context.host.value} / ${context.surface.value} — pattern ${route.pattern}, ` +
      `forge ${route.forge_channel ?? 'none'}, questions ${route.question_channel}, ` +
      `CI wait ${route.ci_wait}, state ${route.state_store}, schedule ${route.schedule}`,
  );
  console.log(
    usage.windows.length
      ? `  usage ${usage.source} (${usage.windows.join(', ')})`
      : `  usage unavailable: ${usage.reason ?? 'no current window'}`,
  );
  if (sleepMode.enabled) console.log('  sleep mode on: owner questions are parked (sleep-mode.md)');
  if (budget.unreadable) console.log('  warn: config.json unreadable, usage_budget treated as disabled');
  for (const warning of route.warnings) console.log(`  warn: ${warning}`);
  for (const gap of route.missing) console.log(`  missing: ${gap}`);
  process.exit(route.missing.length ? 1 : 0);
};

if (import.meta.main) main();
