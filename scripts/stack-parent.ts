import { parseFlags, requireFlag } from './lib/argv-flags.ts';
import { runGh } from './lib/forge-adapter/cli.ts';
import { readJsonFile } from './lib/fs.ts';
import { collectParentFiles, pickStackParent, type StackCandidate } from './lib/stack-parent.ts';

// CLI for queue-dag.md Step 3b: prints the stack-parent pick for one issue as JSON (`null` when none).
const flags = parseFlags(process.argv.slice(2));
const queuePath = requireFlag(flags, 'queue');
const queue = readJsonFile(queuePath, queuePath) as { issues?: Record<string, StackCandidate> };
// --parent-files: JSON {"<parent issue>": ["changed/file", ...]}, read from each open PR when omitted;
// --default-touch-paths: JSON array, the config `default_touch_paths`.
const jsonFlag = (name: string): unknown => {
  const v = flags[name];
  return typeof v === 'string' ? JSON.parse(v) : undefined;
};
const readPrFiles = (pr: number): string[] | null => {
  const r = runGh(['pr', 'diff', String(pr), '--name-only']);
  if (r.status === 0) return r.stdout.split('\n').filter(Boolean);
  console.error(`stack-parent: could not read PR #${pr} files, treating them as unknown: ${r.stderr.trim()}`);
  return null;
};
const issues = queue.issues ?? {};
const issue = Number(requireFlag(flags, 'issue'));
console.log(
  JSON.stringify(
    pickStackParent(issues, issue, {
      parentFiles:
        (jsonFlag('parent-files') as Record<string, string[]> | undefined) ??
        collectParentFiles(issues, issue, readPrFiles),
      defaultTouchPaths: jsonFlag('default-touch-paths') as string[] | undefined,
    }),
  ),
);
