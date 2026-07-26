import * as path from 'path';
import type { StatusArgs, StatusMode } from './types.ts';

const root = path.resolve(import.meta.dirname, '../../..');

/**
 * Parses CLI args into a mode + options. Subcommand dispatch on argv[2] follows the convention
 * forge-scope.ts already uses (`list-args` / `create-args`) to expose a pure helper to
 * prompt-driven agents; omitting the subcommand keeps every existing `bun run status`
 * invocation rendering the dashboard exactly as before.
 * Throws on an unrecognized subcommand rather than silently falling back to the dashboard —
 * a typo'd `config-sumary` must not print the wrong thing and exit 0.
 */
export function parseStatusArgs(argv: string[]): StatusArgs {
  let campaignDir = path.join(root, '.blackhole');
  let skipGh = false;
  let mode: StatusMode = 'dashboard';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--campaign-dir' && argv[i + 1]) {
      campaignDir = path.isAbsolute(argv[i + 1]) ? argv[i + 1] : path.join(root, argv[i + 1]);
      i++;
    } else if (argv[i] === '--no-gh') {
      skipGh = true;
    } else if (i === 0 && !argv[i].startsWith('--')) {
      if (argv[i] !== 'config-summary') {
        throw new Error(
          `Unknown subcommand "${argv[i]}". Usage: bun run status [config-summary] [--campaign-dir <dir>] [--no-gh]`,
        );
      }
      mode = 'config-summary';
    }
  }

  return { mode, campaignDir, skipGh };
}
