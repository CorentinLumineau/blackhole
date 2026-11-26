import * as fs from 'fs';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import * as path from 'path';
import type { RateLimits, RateWindow } from './lib/rate-limit-cache.ts';
import type { Host } from './lib/run-context.ts';
import { resolveCatchup, workersAtFloor, type CatchupConfig } from './lib/catchup.ts';
import { capWorkersByCi, resolveCiCapacityInput } from './lib/ci-capacity.ts';
import { resolveUsageBudget, workersAllowed, type UsageVerdict } from './lib/usage-budget.ts';
import { UsageFileError } from './lib/usage-normalize.ts';
import { resolveHost, restrictWindows, usageSourceFor, type UsageSource } from './lib/usage-source.ts';
import { usageHistoryPathFor } from './lib/usage-history.ts';

// Usage: bun run scripts/usage-budget.ts --parallel-max <n> [--usage '<json>' | --cache <path>]
//        [--host claude|cursor] [--config <path>] [--now <epoch s>]
// `--usage` is the normalized RateLimits JSON the agent builds from its harness usage call:
//   {"five_hour":{"used_percentage":0-100,"resets_at":<epoch s>},"seven_day":{...}}  (either window optional)
// Without it the host's usage source is read (usage-source.ts): the rate-limit cache on Claude, none
// on Cursor (verdict unavailable with the reason; an unknown host still reads the cache). The host is --host, else the one
// run-context.json beside the config records, else the environment's. Prints the verdict
// JSON on stdout (with `weekly_fit` when `usage_budget.weekly.target_at_reset` is set, and
// `five_hour_pct`/`weekly_pct`, the usage judged or null when none was read, so the line passes
// unchanged to `pace-log.ts --usage`; the weekly fit and any PACE-WAIT wake time also go to
// stderr); exit 0 on any verdict, 2 on bad usage, a malformed
// `--usage` (enabled or not) or an invalid config.
// `--floor <pct>` is the catchup gate (ADR-054 C3), for this invocation only: it replaces both
// weekly lines, takes the 5h caps from the `catchup` block, forces the gate on, never writes the
// config, and fails closed: unreadable usage, no weekly window or no plan limits is verdict `SKIP`.
// The output line then carries `floor_pct`. A 0 floor (nothing owed yet this week) is a valid
// floor, judged like any other. `--usage-file <path>` hands the gate a reading saved from a host's
// usage tool, read first in the usage-source chain; under `--floor` an unreadable file is `SKIP`.
// `--ci-capacity '{"idle_runners":n,"queued_jobs":n[,"busy_runners":n][,"queue_allowance":n]}'` (or
// `--ci-capacity-file`) is an optional reading of the consumer's CI runners: it lowers `workers` by the
// queue backlog beyond idle runners and the allowance (default 1), and with every runner busy caps them at
// idle runners plus the allowance, never below one, never above the verdict's own count. It fails open:
// no flag, a flag without a value, both flags, an unreadable file or a malformed reading warns and changes nothing.
const USAGE =
  "usage: usage-budget.ts --parallel-max <n> [--usage '<json>' | --usage-file <path> | --cache <path>] [--host claude|cursor] [--config <path>] [--now <epoch s>] [--floor <pct>] [--ci-capacity '<json>' | --ci-capacity-file <path>]";
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
  const unknown = unknownFlagKeys(flags, ['parallel-max', 'usage', 'usage-file', 'cache', 'host', 'config', 'now', 'floor', 'ci-capacity', 'ci-capacity-file']);
  if (unknown.length) fail(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  const intFlag = (name: string): number | null => {
    const value = Number(flags[name]);
    return typeof flags[name] === 'string' && Number.isInteger(value) && value >= 0 ? value : null;
  };
  const parallelMax = intFlag('parallel-max');
  const now = flags.now === undefined ? Math.floor(Date.now() / 1000) : intFlag('now');
  if (parallelMax === null || now === null) fail('--parallel-max and --now must be non-negative integers');

  let floor: number | null = null;
  if (flags.floor !== undefined) {
    const value = Number(flags.floor);
    if (typeof flags.floor !== 'string' || !Number.isFinite(value) || value < 0 || value > 100) fail('--floor must be a number in [0, 100]');
    floor = value;
  }

  if (flags['usage-file'] !== undefined && typeof flags['usage-file'] !== 'string') fail('--usage-file needs a path');
  if (flags['usage-file'] !== undefined && flags.usage !== undefined) fail('--usage and --usage-file are exclusive');
  const usageFile = flags['usage-file'] as string | undefined;

  const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';
  if (flags.host !== undefined && flags.host !== 'claude' && flags.host !== 'cursor') fail('--host must be claude or cursor');
  const host: Host = (flags.host as Host | undefined) ?? resolveHost(path.dirname(configPath), process.env);
  const ciInput = resolveCiCapacityInput(flags['ci-capacity'], flags['ci-capacity-file'], (file) => fs.readFileSync(file, 'utf-8'));
  if (ciInput.warning) console.error(`usage-budget: ${ciInput.warning}`);
  const ciCapacity = ciInput.capacity;
  let budget;
  let preset: CatchupConfig | null = null;
  let source: UsageSource;
  try {
    const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {};
    budget = resolveUsageBudget(config);
    if (floor !== null) preset = resolveCatchup(config);
    source = usageSourceFor(host, config, {
      cachePath: typeof flags.cache === 'string' ? flags.cache : undefined,
      usageFile,
      historyPath: usageHistoryPathFor(configPath),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  // A malformed --usage is a usage error whether or not the budget is enabled.
  let given: RateLimits | null = null;
  if (typeof flags.usage === 'string') {
    try {
      given = parseUsage(flags.usage);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  let verdict: UsageVerdict;
  let judged: RateLimits | null = null;
  if (floor !== null && preset !== null) {
    // The mode is itself the gate: it runs whatever usage_budget.enabled says.
    let limits: RateLimits | null = given ? restrictWindows(given, budget.windows).limits : null;
    let reason: string | null = given && !limits ? 'usage_budget.windows leaves none of the --usage windows' : null;
    if (!given) {
      try {
        ({ limits, reason } = source.read(now as number));
      } catch (error) {
        // Fail closed: a broken hand-off is a SKIP for the floor gate, never a GO.
        if (!(error instanceof UsageFileError)) throw error;
        limits = null;
        reason = error.message;
      }
    }
    judged = limits;
    verdict = workersAtFloor(limits, now as number, budget, parallelMax as number, floor, preset, {}, reason);
    if (verdict.verdict === 'SKIP') console.error(`usage-budget: SKIP: ${verdict.reasons[0]}`);
  } else if (!budget.enabled) {
    verdict = { verdict: 'unavailable', workers: parallelMax as number, reasons: ['usage_budget disabled'], wake_at: null, hours_to_reset: null, weekly_fit: null };
  } else {
    // A --usage reading honours usage_budget.windows the same way the source does.
    let limits: RateLimits | null = given ? restrictWindows(given, budget.windows).limits : null;
    let reason: string | null = given && !limits ? 'usage_budget.windows leaves none of the --usage windows' : null;
    if (!given) {
      try {
        ({ limits, reason } = source.read(now as number));
      } catch (error) {
        if (error instanceof UsageFileError) return fail(error.message);
        throw error;
      }
    }
    judged = limits;
    verdict = workersAllowed(limits, now as number, budget, parallelMax as number);
    if (reason) verdict.reasons.unshift(reason);
  }
  const ci = capWorkersByCi(verdict.workers, ciCapacity);
  if (ci.applied && ci.reason) {
    verdict.workers = ci.workers;
    verdict.reasons.push(ci.reason);
    console.error(`usage-budget: ${ci.reason}`);
  }
  if (verdict.verdict === 'unavailable') console.error(`usage-budget: ${verdict.reasons[0]}`);
  if (verdict.weekly_fit !== null) {
    console.error(`usage-budget: weekly fit ${verdict.weekly_fit} worker(s) toward ${budget.weekly.target_at_reset}% at reset`);
  }
  if (verdict.verdict === 'PACE-WAIT') console.error(`usage-budget: PACE-WAIT until ${verdict.wake_at}: ${verdict.reasons[0]}`);
  console.log(JSON.stringify({ ...verdict, five_hour_pct: judged?.five_hour?.used_percentage ?? null, weekly_pct: judged?.seven_day?.used_percentage ?? null, ...(floor === null ? {} : { floor_pct: floor }) }));
};

if (import.meta.main) main();
