import * as fs from 'fs';
import * as os from 'os';
import { parseFlags } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import {
  evaluateResourceGate,
  readHostSample,
  resolveResourceGateThresholds,
} from './lib/resource-gate.ts';

// Usage: bun run scripts/resource-gate.ts --requested <n> [--config <path>] [--proc-root <dir>] [--nproc <n>]
// Prints the verdict JSON on stdout; exit 0 on any verdict, 2 on bad usage.
const flags = parseFlags(process.argv.slice(2));
const requested = Number(flags.requested);
if (typeof flags.requested !== 'string' || !Number.isInteger(requested) || requested < 0) {
  console.error('usage: resource-gate.ts --requested <n> [--config <path>] [--proc-root <dir>] [--nproc <n>]');
  process.exit(2);
}
const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';
const config = fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {};
const procRoot = typeof flags['proc-root'] === 'string' ? flags['proc-root'] : '/proc';
const nproc = typeof flags.nproc === 'string' ? Number(flags.nproc) : os.cpus().length;

const verdict = evaluateResourceGate(readHostSample(procRoot, nproc), requested, resolveResourceGateThresholds(config));
if (verdict.verdict === 'unavailable') console.error(`resource-gate: ${verdict.reasons[0]}`);
console.log(JSON.stringify(verdict));
