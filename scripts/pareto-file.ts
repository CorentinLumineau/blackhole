import * as fs from 'fs';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { formatParetoLine, paretoLabel, paretoPriority, reconcileParetoLabels, upsertParetoLine } from './lib/pareto.ts';

// Prose filing sites shell out here for the `Pareto:` body line and the `pareto:P1..P4` label, so
// no site hand-types either (V-PARETO-02). Thin over `lib/pareto.ts`; prints, never writes.

const USAGE = [
  'Usage: bun run scripts/pareto-file.ts <line|label> --gain <1-10> --effort <1-10>',
  '       bun run scripts/pareto-file.ts edit-args --gain <n> --effort <n> --labels <csv>',
  '       bun run scripts/pareto-file.ts body --gain <n> --effort <n> --body-file <path>',
].join('\n');

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const unknown = unknownFlagKeys(flags, ['gain', 'effort', 'labels', 'body-file']);
  if (unknown.length) fail(`Unknown flag(s): ${unknown.join(', ')}`);
  if (!['line', 'label', 'edit-args', 'body'].includes(command ?? '')) fail(`Unknown subcommand: ${command ?? '(none)'}`);
  // A valueless flag binds to boolean `true`; Number(true) would read as 1, so only strings count.
  const num = (v: unknown): number => (typeof v === 'string' ? Number(v) : NaN);
  const scoring = { gain: num(flags.gain), effort: num(flags.effort) };
  let priority: number;
  try {
    priority = paretoPriority(scoring.gain, scoring.effort);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (command === 'line') console.log(formatParetoLine(scoring));
  else if (command === 'label') console.log(paretoLabel(priority));
  else if (command === 'edit-args') {
    const labels = typeof flags.labels === 'string' ? flags.labels.split(',').filter(Boolean) : [];
    const { add, remove } = reconcileParetoLabels(labels, priority);
    console.log([...add.map((l) => `--add-label ${l}`), ...remove.map((l) => `--remove-label ${l}`)].join(' '));
  } else {
    const file = flags['body-file'];
    if (typeof file !== 'string' || !fs.existsSync(file)) fail(`--body-file not found: ${String(file)}`);
    // No added newline: the body round-trips byte-for-byte, so a re-score of an unchanged body is a no-op.
    process.stdout.write(upsertParetoLine(fs.readFileSync(file, 'utf8'), scoring));
  }
}

if (import.meta.main) main();
