import * as fs from 'fs';
import { parseFlags } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { buildNoiseReport, parseSince, renderNoiseMarkdown } from './lib/review-noise-report.ts';

// Usage: bun run scripts/review-noise-report.ts [--since 7d] [--ledger <path>] [--json]
// Prints a per-V-code review-noise table (markdown, or JSON with --json); exit 0, or 2 on bad usage.
const usage = 'usage: review-noise-report.ts [--since <n>h|d|w] [--ledger <path>] [--json]';
const flags = parseFlags(process.argv.slice(2));
const fail = (message: string): never => {
  console.error(`review-noise-report: ${message}\n${usage}`);
  process.exit(2);
};
const ledgerPath = typeof flags.ledger === 'string' ? flags.ledger : '.blackhole/findings-ledger.json';
if (!fs.existsSync(ledgerPath)) fail(`ledger not found: ${ledgerPath}`);
let sinceMs = 0;
try {
  sinceMs = parseSince(typeof flags.since === 'string' ? flags.since : '7d');
} catch (error) {
  fail(String(error instanceof Error ? error.message : error));
}
const ledger = readJsonFile(ledgerPath, ledgerPath) as { findings?: unknown[] };
const report = buildNoiseReport(ledger.findings ?? [], { now: Date.now(), sinceMs });
console.log(flags.json === true ? JSON.stringify(report, null, 2) : renderNoiseMarkdown(report));
