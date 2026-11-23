import * as path from 'path';
import type { CatchupArgs, StatusArgs, StatusMode } from './types.ts';

// Campaign state belongs to the project the command runs in, not to wherever this script is
// installed (a plugin cache or vendor/blackhole) — resolve it from the working directory.
const projectRoot = (): string => process.cwd();

const resolveFromRoot = (p: string): string => (path.isAbsolute(p) ? p : path.join(projectRoot(), p));

/** The status command by absolute path: it resolves from any cwd, inside or outside a checkout (ADR-056). */
export const STATUS_COMMAND = `bun run "${path.resolve(import.meta.dir, '..', '..', 'campaign-status.ts')}"`;

const USAGE =
  `Usage: ${STATUS_COMMAND} [config-summary | target [--stated <repo>] [--json] | usage-caps --enabled <true|false> [--stop-workers-at <6-100>] [--target-at-reset <1-100|none>]] [--json | --html [--out <path>] | --data <dir> | --summary [--mode run|catchup] [--usage <json>] [--now <epoch s>] [--json] [--unattended] [catchup only: --usage-file <path> --floor <pct> --no-spawn-at <pct> --stop-workers-at <pct> --lane <name>]] [--campaign-dir <dir>] [--no-gh]`;

const pctFlag = (flags: Record<string, string>, name: string): number | null => {
  if (flags[name] === undefined) return null;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new Error(`${name} must be a number in (0, 100]. ${USAGE}`);
  return value;
};

const catchupArgs = (flags: Record<string, string>): CatchupArgs => ({
  usageFile: flags['--usage-file'] === undefined ? null : resolveFromRoot(flags['--usage-file']),
  floorPct: pctFlag(flags, '--floor'),
  noSpawnAt: pctFlag(flags, '--no-spawn-at'),
  stopWorkersAt: pctFlag(flags, '--stop-workers-at'),
  lane: flags['--lane'] ?? null,
});

/**
 * Parses CLI args into a mode + options. Subcommand dispatch on argv[2] follows the convention
 * forge-scope.ts already uses (`list-args` / `create-args`) to expose a pure helper to
 * prompt-driven agents; omitting the subcommand keeps every existing `bun run status`
 * invocation rendering the dashboard exactly as before.
 * Throws on an unrecognized subcommand or a contradictory flag set rather than silently falling
 * back to the dashboard — a typo'd `config-sumary` must not print the wrong thing and exit 0.
 */
export function parseStatusArgs(argv: string[]): StatusArgs {
  let campaignDir = path.join(projectRoot(), '.blackhole');
  let skipGh = false;
  let mode: StatusMode = 'dashboard';
  let json = false;
  let html = false;
  let outPath: string | null = null;
  let dataDir: string | null = null;
  let summary = false;
  let unattended = false;
  let usage: string | null = null;
  let now: number | null = null;
  let summaryMode = 'run';
  const catchupFlags: Record<string, string> = {};
  const CATCHUP_FLAGS = ['--usage-file', '--floor', '--no-spawn-at', '--stop-workers-at', '--lane'];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--campaign-dir' && argv[i + 1]) {
      campaignDir = resolveFromRoot(argv[i + 1]);
      i++;
    } else if (argv[i] === '--out' && argv[i + 1]) {
      outPath = resolveFromRoot(argv[i + 1]);
      i++;
    } else if (argv[i] === '--data') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`--data requires a directory. ${USAGE}`);
      dataDir = resolveFromRoot(argv[i + 1]);
      i++;
    } else if (argv[i] === '--usage') {
      if (argv[i + 1] === undefined) throw new Error(`--usage requires a JSON value. ${USAGE}`);
      usage = argv[i + 1];
      i++;
    } else if (argv[i] === '--now') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 0) throw new Error(`--now requires epoch seconds. ${USAGE}`);
      now = value;
      i++;
    } else if (argv[i] === '--mode') {
      if (argv[i + 1] !== 'run' && argv[i + 1] !== 'catchup') throw new Error(`--mode must be run or catchup. ${USAGE}`);
      summaryMode = argv[i + 1];
      i++;
    } else if (CATCHUP_FLAGS.includes(argv[i])) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${argv[i]} requires a value. ${USAGE}`);
      catchupFlags[argv[i]] = argv[i + 1];
      i++;
    } else if (argv[i] === '--summary') {
      summary = true;
    } else if (argv[i] === '--unattended') {
      unattended = true;
    } else if (argv[i] === '--no-gh') {
      skipGh = true;
    } else if (argv[i] === '--json') {
      json = true;
    } else if (argv[i] === '--html') {
      html = true;
    } else if (i === 0 && !argv[i].startsWith('--')) {
      if (argv[i] !== 'config-summary') {
        throw new Error(`Unknown subcommand "${argv[i]}". ${USAGE}`);
      }
      mode = 'config-summary';
    }
  }

  if (summary && (html || dataDir || outPath || mode === 'config-summary')) {
    throw new Error(`--summary takes only --usage, --now and --json. ${USAGE}`);
  }
  if (!summary && unattended) throw new Error(`--unattended requires --summary. ${USAGE}`);
  if (!summary && (usage !== null || now !== null)) throw new Error(`--usage and --now require --summary. ${USAGE}`);
  if (!summary && summaryMode !== 'run') throw new Error(`--mode requires --summary. ${USAGE}`);
  const given = Object.keys(catchupFlags);
  if (summaryMode !== 'catchup' && given.length) throw new Error(`${given.join(', ')} require --summary --mode catchup. ${USAGE}`);
  if (summaryMode === 'catchup' && usage !== null) throw new Error(`--usage (inline) is not accepted with --mode catchup: pass --usage-file <path>. ${USAGE}`);
  if (summary) {
    const catchup = summaryMode === 'catchup' ? catchupArgs(catchupFlags) : null;
    return { mode: 'summary', campaignDir, skipGh, outPath: null, dataDir: null, usage, now, summaryJson: json, catchup, unattended };
  }
  if (json && html) throw new Error(`Pass either --json or --html, not both. ${USAGE}`);
  if (dataDir && (json || html)) throw new Error(`Pass only one of --json, --html or --data. ${USAGE}`);
  if (outPath && !html) throw new Error(`--out requires --html. ${USAGE}`);
  if (json) mode = 'json';
  if (html) mode = 'html';
  if (dataDir) mode = 'data';

  return { mode, campaignDir, skipGh, outPath, dataDir, usage: null, now: null, summaryJson: false, catchup: null, unattended: false };
}
