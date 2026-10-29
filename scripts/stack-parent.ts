import { parseFlags, requireFlag } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { pickStackParent, type StackCandidate } from './lib/stack-parent.ts';

// CLI for queue-dag.md Step 3b: prints the stack-parent pick for one issue as JSON (`null` when none).
const flags = parseFlags(process.argv.slice(2));
const queuePath = requireFlag(flags, 'queue');
const queue = readJsonFile(queuePath, queuePath) as { issues?: Record<string, StackCandidate> };
console.log(JSON.stringify(pickStackParent(queue.issues ?? {}, Number(requireFlag(flags, 'issue')))));
