import { parseFlags } from './lib/argv-flags.ts';
import { appendPaceLog, buildPaceRecord } from './lib/pace-log.ts';

// Usage: bun run scripts/pace-log.ts --planned <n> --pace '<pace-gate JSON>' [--resource '<resource-gate JSON>'] [--log <path>] [--now <epoch s>]
// Appends this spawn round's record to .blackhole/pace-log.jsonl and prints it; exit 0, or 2 on bad usage.
const usage = "usage: pace-log.ts --planned <n> --pace '<json>' [--resource '<json>'] [--log <path>] [--now <epoch s>]";
const flags = parseFlags(process.argv.slice(2));
const fail = (message: string): never => {
  console.error(`pace-log: ${message}\n${usage}`);
  process.exit(2);
};
const planned = Number(flags.planned);
if (typeof flags.planned !== 'string' || !Number.isInteger(planned) || planned < 0) fail('--planned must be a non-negative integer');
const now = typeof flags.now === 'string' ? Number(flags.now) : Math.floor(Date.now() / 1000);
if (!Number.isFinite(now)) fail('--now must be epoch seconds');
const parseVerdict = (name: string, required: boolean) => {
  const raw = flags[name];
  if (typeof raw !== 'string') return required ? fail(`--${name} is required`) : null;
  try {
    return JSON.parse(raw);
  } catch {
    return fail(`--${name} is not valid JSON`);
  }
};
const record = buildPaceRecord(now, planned, parseVerdict('pace', true), parseVerdict('resource', false));
appendPaceLog(typeof flags.log === 'string' ? flags.log : '.blackhole/pace-log.jsonl', record);
console.log(JSON.stringify(record));
