import * as fs from 'fs';
import { extractWorkerJson, parseJsonObject } from './lib/worker-json/extract.ts';
import { resolveRole } from './lib/worker-json/resolve-role.ts';
import { readTranscriptTail } from './lib/worker-json/transcript.ts';
import type { HookInput, Role } from './lib/worker-json/types.ts';
import { extractFromHookInput, validateWorker } from './lib/worker-json/validate.ts';

export type { HookInput, Role } from './lib/worker-json/types.ts';
export { extractFromHookInput, extractWorkerJson, readTranscriptTail, resolveRole, validateWorker };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function printValidationErrors(errors: string[]) {
  for (const error of errors) {
    console.error(error);
  }
}

async function runHook(): Promise<number> {
  let raw: string;
  try {
    raw = await readStdin();
  } catch (error) {
    console.error(`hook stdin read failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (!raw.trim()) {
    console.error('hook stdin: empty payload');
    return 2;
  }

  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch (error) {
    console.error(`hook stdin JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (input.status === 'error' || input.status === 'aborted') {
    return 0;
  }

  const role = resolveRole(input);
  if (!role) {
    return 0;
  }

  let workerJson: unknown;
  try {
    workerJson = extractFromHookInput(input);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const errors = validateWorker(role, workerJson);
  if (errors.length > 0) {
    printValidationErrors(errors);
    return 1;
  }

  return 0;
}

function parseCliArgs(argv: string[]) {
  let hook = false;
  let role: Role | null = null;
  let file: string | null = null;
  let json: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hook') {
      hook = true;
    } else if (arg === '--role' && argv[i + 1]) {
      role = argv[++i] as Role;
    } else if (arg === '--file' && argv[i + 1]) {
      file = argv[++i];
    } else if (arg === '--json' && argv[i + 1]) {
      json = argv[++i];
    }
  }

  return { hook, role, file, json };
}

function runCli(role: Role, payload: unknown): number {
  const errors = validateWorker(role, payload);
  if (errors.length > 0) {
    printValidationErrors(errors);
    return 1;
  }
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const { hook, role, file, json } = parseCliArgs(argv);

  if (hook || (argv.length === 0 && !process.stdin.isTTY)) {
    process.exit(await runHook());
  }

  if (!role) {
    console.error(
      'Usage: bun run scripts/validate-worker-json.ts --hook\n' +
        '       bun run scripts/validate-worker-json.ts --role <planner|implementer|reviewer|router|investigator|hunter> (--file <path> | --json <string>)',
    );
    process.exit(1);
  }

  let payload: unknown;
  try {
    if (file) {
      payload = parseJsonObject(fs.readFileSync(file, 'utf-8'), file);
    } else if (json) {
      payload = parseJsonObject(json, '--json');
    } else {
      console.error('CLI mode requires --file or --json');
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  process.exit(runCli(role, payload));
}

if (import.meta.main) {
  main();
}
