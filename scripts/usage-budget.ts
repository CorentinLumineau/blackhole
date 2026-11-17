import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { readRateLimits, resolvePaceGateThresholds, type RateLimits, type RateWindow } from './lib/pace-gate.ts';
import { resolveUsageBudget, workersAllowed, type UsageVerdict } from './lib/usage-budget.ts';

// Usage: bun run scripts/usage-budget.ts --parallel-max <n> [--usage '<json>' | --cache <path>]
//        [--config <path>] [--now <epoch s>]
// `--usage` is the normalized RateLimits JSON the agent builds from its harness usage call:
//   {"five_hour":{"used_percentage":0-100,"resets_at":<epoch s>},"seven_day":{...}}  (either window optional)
// Without it the statusline cache is read through pace-gate.ts's readRateLimits. Prints the verdict
// JSON on stdout; exit 0 on any verdict, 2 on bad usage, a malformed `--usage` or an invalid config.
const USAGE =
  "usage: usage-budget.ts --parallel-max <n> [--usage '<json>' | --cache <path>] [--config <path>] [--now <epoch s>]";
const fail = (message: string): never => {
  console.error(`usage-budget: ${message}\n${USAGE}`);
  process.exit(2);
};

const isWindow = (v: unknown): v is RateWindow =>
  typeof v === 'object' &&
  v !== null &&
  Number.isFinite((v as RateWindow).used_percentage) &&
  (v as RateWindow).used_percentage >= 0 &&
  (v as RateWindow).used_percentage <= 100 &&
  Number.isFinite((v as RateWindow).resets_at) &&
  (v as RateWindow).resets_at > 0;

export const parseUsage = (raw: string): RateLimits => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('--usage is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('--usage must be a JSON object');
  const out: RateLimits = {};
  for (const name of ['five_hour', 'seven_day'] as const) {
    const w = (parsed as Record<string, unknown>)[name];
    if (w === undefined) continue;
    if (!isWindow(w)) throw new Error(`--usage ${name} must be {used_percentage 0-100, resets_at epoch seconds > 0}`);
    out[name] = w;
  }
  if (!out.five_hour && !out.seven_day) throw new Error('--usage carries no five_hour or seven_day window');
  return out;
};

const main = (): void => {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['parallel-max', 'usage', 'cache', 'config', 'now']);
  if (unknown.length) fail(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  const intFlag = (name: string): number | null => {
    const value = Number(flags[name]);
    return typeof flags[name] === 'string' && Number.isInteger(value) && value >= 0 ? value : null;
  };
  const parallelMax = intFlag('parallel-max');
  const now = flags.now === undefined ? Math.floor(Date.now() / 1000) : intFlag('now');
  if (parallelMax === null || now === null) fail('--parallel-max and --now must be non-negative integers');

  const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';
  let budget;
  let cachePath = typeof flags.cache === 'string' ? flags.cache : '';
  let maxAge = 600;
  try {
    const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {};
    budget = resolveUsageBudget(config);
    maxAge = resolvePaceGateThresholds(config).maxAgeSeconds;
    const pace = ((config.resource_policy ?? {}) as { pace?: { cache_path?: unknown } }).pace;
    if (!cachePath) cachePath = typeof pace?.cache_path === 'string' ? pace.cache_path : path.join(os.homedir(), '.claude', 'cache', 'rate-limits.json');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  let verdict: UsageVerdict;
  if (!budget.enabled) {
    verdict = { verdict: 'unavailable', workers: parallelMax as number, reasons: ['usage_budget disabled'], wake_at: null, hours_to_reset: null };
  } else {
    let limits: RateLimits | null;
    let reason: string | null = null;
    if (typeof flags.usage === 'string') {
      try {
        limits = parseUsage(flags.usage);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    } else {
      ({ limits, reason } = readRateLimits(cachePath, now as number, maxAge));
    }
    verdict = workersAllowed(limits, now as number, budget, parallelMax as number);
    if (reason) verdict.reasons.unshift(reason);
  }
  if (verdict.verdict === 'unavailable') console.error(`usage-budget: ${verdict.reasons[0]}`);
  console.log(JSON.stringify(verdict));
};

if (import.meta.main) main();
