import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFlags } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { evaluatePaceGate, readBaseline, readRateLimits, resolvePaceGateThresholds, rollBaseline, type BaselineInput } from './lib/pace-gate.ts';

// Usage: bun run scripts/pace-gate.ts --current <n> --max <n> [--cache <path>] [--config <path>] [--now <epoch s>]
// Prints the verdict JSON on stdout; exit 0 on any verdict, 2 on bad usage or a malformed config.
const usage = 'usage: pace-gate.ts --current <n> --max <n> [--cache <path>] [--config <path>] [--now <epoch s>]';
const flags = parseFlags(process.argv.slice(2));
const intFlag = (name: string): number | null => {
  const value = Number(flags[name]);
  return typeof flags[name] === 'string' && Number.isInteger(value) && value >= 0 ? value : null;
};
const current = intFlag('current');
const max = intFlag('max');
const now = typeof flags.now === 'string' ? intFlag('now') : Math.floor(Date.now() / 1000);
if (current === null || max === null || now === null) {
  console.error(usage);
  process.exit(2);
}

const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';
let thresholds;
let cachePath = typeof flags.cache === 'string' ? flags.cache : '';
let baselinePath = '';
try {
  const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {};
  thresholds = resolvePaceGateThresholds(config);
  const pace = ((config.resource_policy ?? {}) as { pace?: { cache_path?: unknown; baseline_path?: unknown } }).pace;
  if (!cachePath) cachePath = typeof pace?.cache_path === 'string' ? pace.cache_path : path.join(os.homedir(), '.claude', 'cache', 'rate-limits.json');
  baselinePath = typeof pace?.baseline_path === 'string' ? pace.baseline_path : path.join(path.dirname(cachePath), 'pace-baseline.json');
} catch (error) {
  console.error(`pace-gate: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const { limits, reason } = readRateLimits(cachePath, now, thresholds.maxAgeSeconds);
// The run that records a day's or session's baseline has nothing to compare against yet; a missing
// or corrupt baseline file is replaced and that run reports the compartments unavailable with why.
let compartments: BaselineInput | undefined;
if (limits?.seven_day) {
  const stored = readBaseline(baselinePath);
  const rolled = rollBaseline({ ...limits, seven_day: limits.seven_day }, stored.baseline, now);
  try {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(`${baselinePath}.tmp`, JSON.stringify(rolled));
    fs.renameSync(`${baselinePath}.tmp`, baselinePath);
    compartments = stored.baseline ? { baseline: rolled, reason: null } : { baseline: null, reason: `${stored.reason}; recorded now` };
  } catch (error) {
    compartments = { baseline: null, reason: `cannot write pace baseline at ${baselinePath}: ${error instanceof Error ? error.message : String(error)}` };
  }
} else if (limits) {
  compartments = { baseline: null, reason: 'no seven_day window in the cache' };
}
const verdict = evaluatePaceGate(limits, current, max, now, thresholds, reason ? `unavailable: ${reason}` : undefined, compartments);
if (verdict.verdict === 'unavailable') console.error(`pace-gate: ${verdict.reasons[0]}`);
console.log(JSON.stringify(verdict));
