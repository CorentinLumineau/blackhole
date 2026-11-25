import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { AGENT_NAMES } from './lib/build/facts.ts';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';

// Usage: bun run scripts/worker-context-size.ts [--json]
// Prints the plugin-controlled part of a worker spawn's first-turn context (issue #1387): the
// compiled agent definitions under agents/ and the reference files a worker shell tells it to read
// in full. Every figure is bytes / 4, an ESTIMATE and not tokenizer output; it exists to compare a
// before with an after reproducibly, not to bill. No network, no tokenizer dependency. The harness
// base (CLAUDE.md, rules, skill listing, MCP tool names) is outside this repo and not measured.

// Files a worker is told to read whole (`Binding rules:` line and the schema/contract references).
export const MANDATORY_READS = [
  'src/references/blackhole-vcodes.md',
  'src/references/worker-schemas.md',
  'src/references/review-core.md',
  'src/references/implementer-schemas.md',
];

type Size = { bytes: number; tokens: number };
export type SizeReport = { estimate: 'bytes/4'; agents: Record<string, Size>; reads: Record<string, Size> };

export const estimateTokens = (bytes: number): number => Math.floor(bytes / 4);

const sizeOf = (rel: string, rootDir: string): Size => {
  const abs = path.join(rootDir, rel);
  if (!fs.existsSync(abs)) throw new Error(`worker-context-size: ${rel} not found under ${rootDir}`);
  const bytes = fs.statSync(abs).size;
  return { bytes, tokens: estimateTokens(bytes) };
};

export const computeAgentTokens = (rel: string, rootDir: string = root): number => sizeOf(rel, rootDir).tokens;

export const sizeReport = (rootDir: string = root): SizeReport => ({
  estimate: 'bytes/4',
  agents: Object.fromEntries(AGENT_NAMES.map((n) => [n, sizeOf(`agents/${n}.md`, rootDir)])),
  reads: Object.fromEntries(MANDATORY_READS.map((f) => [f, sizeOf(f, rootDir)])),
});

const USAGE = 'usage: worker-context-size.ts [--json]';

const main = (): void => {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = unknownFlagKeys(flags, ['json']);
  if (unknown.length) {
    console.error(`worker-context-size: unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}\n${USAGE}`);
    process.exit(2);
  }
  const report = sizeReport();
  if (flags.json) return console.log(JSON.stringify(report, null, 2));
  console.log('Worker context size (estimate: bytes / 4, not tokenizer output)');
  for (const [group, rows] of [['agents/', report.agents], ['mandatory reads', report.reads]] as const) {
    console.log(`\n${group}`);
    for (const [name, s] of Object.entries(rows)) console.log(`  ${name.padEnd(42)} ${String(s.bytes).padStart(7)} B  ${String(s.tokens).padStart(6)} tokens`);
  }
};

if (import.meta.main) main();
