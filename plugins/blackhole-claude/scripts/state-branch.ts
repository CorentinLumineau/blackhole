import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { pullState, pushState, STATE_BRANCH } from './lib/state-branch.ts';

// Branch state store CLI (ADR-049). `push` at every turn end and `pull` before reading state on
// resume, when `.blackhole/run-context.json` routes `state_store: branch`. Runs in the main clone.

const USAGE =
  'Usage: bun run scripts/state-branch.ts push [--message <text>] [--remote <name>]\n' +
  '       bun run scripts/state-branch.ts pull [--force] [--remote <name>]';

const main = (): number => {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const unknown = unknownFlagKeys(flags, ['message', 'remote', 'force']);
  if ((command !== 'push' && command !== 'pull') || unknown.length) {
    console.error(USAGE);
    return 2;
  }
  const repoRoot = process.cwd();
  const remote = typeof flags.remote === 'string' ? flags.remote : 'origin';

  if (command === 'push') {
    const message = typeof flags.message === 'string' ? flags.message : 'chore(state): campaign checkpoint';
    const result = pushState(repoRoot, message, remote);
    if (result.status === 'empty') console.log('State: nothing under .blackhole/ to push.');
    else if (result.status === 'unchanged') console.log(`State: ${STATE_BRANCH} already holds these ${result.files} files.`);
    else console.log(`State: pushed ${result.files} files to ${STATE_BRANCH} (${result.commit?.slice(0, 8)}).`);
    return 0;
  }

  const result = pullState(repoRoot, { force: flags.force === true, remote });
  if (result.status === 'absent') {
    console.log(`State: no ${STATE_BRANCH} branch on ${remote}; starting from local state.`);
    return 0;
  }
  if (result.status === 'conflict') {
    console.error(`State: these local files differ from ${STATE_BRANCH} (${result.commit.slice(0, 8)}):`);
    for (const rel of result.differing) console.error(`  ${rel}`);
    console.error('Keep the local copy (it may be newer than the last push) or rerun with --force to take the branch.');
    return 1;
  }
  console.log(
    `State: restored ${result.written.length} files from ${STATE_BRANCH} (${result.commit.slice(0, 8)}); ` +
      `${result.unchanged} already matched.`,
  );
  return 0;
};

if (import.meta.main) process.exit(main());
