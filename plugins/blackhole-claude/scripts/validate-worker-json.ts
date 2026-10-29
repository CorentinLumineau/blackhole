import * as fs from 'fs';
import {
  ENUM_SOURCE_MISSING_VALUE_ERROR,
  resolveValidateWorker,
  type ValidateWorkerFn,
} from './lib/worker-json/enum-source.ts';
import { extractWorkerJson, parseJsonObject } from './lib/worker-json/extract.ts';
import { resolveRole } from './lib/worker-json/resolve-role.ts';
import { extractLastAssistantText, readTranscriptTail } from './lib/worker-json/transcript.ts';
import type { HookInput, Role } from './lib/worker-json/types.ts';
import { extractFromHookInput, validateWorker } from './lib/worker-json/validate.ts';
import { parseFlags } from './lib/argv-flags.ts';

export type { HookInput, Role } from './lib/worker-json/types.ts';
export type { ValidateWorkerFn } from './lib/worker-json/enum-source.ts';
export {
  extractFromHookInput,
  extractLastAssistantText,
  extractWorkerJson,
  readTranscriptTail,
  resolveRole,
  resolveValidateWorker,
  validateWorker,
};

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

async function runHook(validate: ValidateWorkerFn): Promise<number> {
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

  const errors = validate(role, workerJson);
  if (errors.length > 0) {
    printValidationErrors(errors);
    return 1;
  }

  return 0;
}

function parseCliArgs(argv: string[]) {
  const flags = parseFlags(argv);

  // A flag whose value never arrived (bare trailing `--enum-source`, or immediately followed by
  // another flag name) must not be indistinguishable from a run that never named a tree at all
  // — falling through to the local enums would accept-or-reject against the wrong tree while
  // reporting nothing about the unusable flag. An explicit empty string (`''`) is rejected the
  // same way.
  const enumSourceRaw = flags['enum-source'];
  if (enumSourceRaw === true || enumSourceRaw === '') {
    throw new Error(ENUM_SOURCE_MISSING_VALUE_ERROR);
  }

  return {
    hook: flags.hook === true,
    role: typeof flags.role === 'string' ? (flags.role as Role) : null,
    file: typeof flags.file === 'string' ? flags.file : null,
    json: typeof flags.json === 'string' ? flags.json : null,
    recoverTranscript: typeof flags['recover-transcript'] === 'string' ? flags['recover-transcript'] : null,
    enumSource: typeof enumSourceRaw === 'string' ? enumSourceRaw : null,
  };
}

function runCli(validate: ValidateWorkerFn, role: Role, payload: unknown): number {
  const errors = validate(role, payload);
  if (errors.length > 0) {
    printValidationErrors(errors);
    return 1;
  }
  return 0;
}

/**
 * Recovers a worker's return JSON from its own persisted Claude Code subagent
 * transcript when the return never reached the orchestrator (`recovery-protocol.md`
 * §10). Fails loudly at every step — a missing transcript, a text-less final
 * turn, an unparsable extraction, or a schema-invalid recovered payload are all
 * reported to stderr and exit non-zero, never silently treated as "worker
 * produced nothing".
 */
function runRecoverTranscript(
  validate: ValidateWorkerFn,
  role: Role,
  transcriptPath: string,
): number {
  const tail = readTranscriptTail(transcriptPath, 200_000);
  if (tail === null) {
    console.error(`transcript not found or unreadable: ${transcriptPath}`);
    return 1;
  }

  const text = extractLastAssistantText(tail);
  if (text === null) {
    console.error('no assistant message found in transcript');
    return 1;
  }

  let workerJson: unknown;
  try {
    workerJson = extractWorkerJson(text);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const errors = validate(role, workerJson);
  if (errors.length > 0) {
    printValidationErrors(errors);
    return 1;
  }

  console.log(JSON.stringify(workerJson));
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);

  let args: ReturnType<typeof parseCliArgs>;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const { hook, role, file, json, recoverTranscript, enumSource } = args;

  let validate: ValidateWorkerFn;
  try {
    validate = await resolveValidateWorker(enumSource);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  if (hook || (argv.length === 0 && !process.stdin.isTTY)) {
    process.exit(await runHook(validate));
  }

  if (!role) {
    console.error(
      'Usage: bun run scripts/validate-worker-json.ts --hook\n' +
        '       bun run scripts/validate-worker-json.ts --role <planner|implementer|reviewer|router|investigator|hunter> (--file <path> | --json <string>)\n' +
        '       bun run scripts/validate-worker-json.ts --role <role> --recover-transcript <path>\n' +
        '       add --enum-source <tree root> to any of the above to read the role schema enums\n' +
        '       from that tree instead of this one — role resolution stays local (exit 2 when the\n' +
        '       named tree holds no validator module, or when the flag carries no value)',
    );
    process.exit(1);
  }

  if (recoverTranscript && !file && !json) {
    process.exit(runRecoverTranscript(validate, role, recoverTranscript));
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

  process.exit(runCli(validate, role, payload));
}

if (import.meta.main) {
  main();
}
