import * as path from 'path';
import type { StatusArgs, StatusMode } from './types.ts';

// Campaign state belongs to the project the command runs in, not to wherever this script is
// installed (a plugin cache or vendor/blackhole) — resolve it from the working directory.
const projectRoot = (): string => process.cwd();

const resolveFromRoot = (p: string): string => (path.isAbsolute(p) ? p : path.join(projectRoot(), p));

const USAGE =
  'Usage: bun run status [config-summary] [--json | --html [--out <path>] | --data <dir>] [--campaign-dir <dir>] [--no-gh]';

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

  if (json && html) throw new Error(`Pass either --json or --html, not both. ${USAGE}`);
  if (dataDir && (json || html)) throw new Error(`Pass only one of --json, --html or --data. ${USAGE}`);
  if (outPath && !html) throw new Error(`--out requires --html. ${USAGE}`);
  if (json) mode = 'json';
  if (html) mode = 'html';
  if (dataDir) mode = 'data';

  return { mode, campaignDir, skipGh, outPath, dataDir };
}
