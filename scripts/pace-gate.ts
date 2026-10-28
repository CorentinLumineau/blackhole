import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFlags } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { evaluatePaceGate, readRateLimits, resolvePaceGateThresholds } from './lib/pace-gate.ts';

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
try {
  const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {};
  thresholds = resolvePaceGateThresholds(config);
  const configured = ((config.resource_policy ?? {}) as { pace?: { cache_path?: unknown } }).pace?.cache_path;
  if (!cachePath) cachePath = typeof configured === 'string' ? configured : path.join(os.homedir(), '.claude', 'cache', 'rate-limits.json');
} catch (error) {
  console.error(`pace-gate: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const { limits, reason } = readRateLimits(cachePath, now, thresholds.maxAgeSeconds);
const verdict = evaluatePaceGate(limits, current, max, now, thresholds, reason ? `unavailable: ${reason}` : undefined);
if (verdict.verdict === 'unavailable') console.error(`pace-gate: ${verdict.reasons[0]}`);
console.log(JSON.stringify(verdict));
