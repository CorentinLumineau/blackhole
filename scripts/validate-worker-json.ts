import * as fs from 'fs';

export type Role = 'planner' | 'implementer' | 'reviewer';

export type HookInput = {
  subagent_type?: string;
  description?: string;
  task?: string;
  status?: string;
  summary?: string;
  agent_transcript_path?: string;
};

const PLANNER_STATUSES = ['ready', 'blocked', 'error'] as const;
const IMPLEMENTER_STATUSES = ['complete', 'blocked', 'error'] as const;
const REVIEWER_STATUSES = ['complete', 'error'] as const;
const TRACKS = ['quick', 'standard'] as const;
const SEVERITIES = ['BLOCK', 'WARN', 'INFO'] as const;

const ROLE_FROM_TYPE: Record<string, Role> = {
  'bc-planner': 'planner',
  'bc-implementer': 'implementer',
  'bc-reviewer': 'reviewer',
};

const ROLE_PATTERN =
  /\bbc-(planner|implementer|reviewer)\b/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && !Number.isNaN(item));
}

function pushEnumError(errors: string[], field: string, value: unknown, allowed: readonly string[]) {
  if (!allowed.includes(String(value))) {
    errors.push(`${field}: invalid enum value "${String(value)}" (expected ${allowed.join('|')})`);
  }
}

function requireField(
  errors: string[],
  obj: Record<string, unknown>,
  field: string,
  predicate: (value: unknown) => boolean,
  typeLabel: string,
) {
  if (!(field in obj)) {
    errors.push(`${field}: required`);
    return;
  }
  if (!predicate(obj[field])) {
    errors.push(`${field}: expected ${typeLabel}`);
  }
}

function validateFinding(finding: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(finding)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, finding, 'vcode', isString, 'string');
  requireField(errors, finding, 'severity', isString, 'string');
  if (isString(finding.severity)) {
    pushEnumError(errors, `${path}.severity`, finding.severity, SEVERITIES);
  }
  requireField(errors, finding, 'file', isString, 'string');
  requireField(errors, finding, 'line', isNumber, 'number');
  requireField(errors, finding, 'summary', isString, 'string');

  if (finding.vcode === 'V-PARETO-02') {
    requireField(errors, finding, 'gain', isNumber, 'number');
    requireField(errors, finding, 'effort', isNumber, 'number');
  }

  return errors;
}

function validateFindingsArray(value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return errors;
  }
  value.forEach((finding, index) => {
    errors.push(...validateFinding(finding, `${path}[${index}]`));
  });
  return errors;
}

function validatePlanner(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, PLANNER_STATUSES);
  }

  const status = data.status;
  if (status === 'ready') {
    requireField(errors, data, 'plan_path', isString, 'string');
    requireField(errors, data, 'track', isString, 'string');
    if (isString(data.track)) {
      pushEnumError(errors, 'track', data.track, TRACKS);
    }
    if (!Array.isArray(data.failing_checks)) {
      errors.push('failing_checks: expected array');
    }
    requireField(errors, data, 'clarification_markers', isNumber, 'number');
  } else if (status === 'blocked') {
    if (!isStringArray(data.failing_checks)) {
      errors.push('failing_checks: expected string[]');
    }
    requireField(errors, data, 'clarification_markers', isNumber, 'number');
  }

  return errors;
}

function validateImplementer(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, IMPLEMENTER_STATUSES);
  }

  if (data.status === 'complete') {
    requireField(errors, data, 'pr_number', isNumber, 'number');
    requireField(errors, data, 'branch', isString, 'string');
    requireField(errors, data, 'tests_passed', isBoolean, 'boolean');
    requireField(errors, data, 'touch_paths_honored', isBoolean, 'boolean');
  }

  if ('new_findings' in data && data.new_findings !== undefined && !Array.isArray(data.new_findings)) {
    errors.push('new_findings: expected array');
  }

  if ('filed_issues' in data && data.filed_issues !== undefined && !isNumberArray(data.filed_issues)) {
    errors.push('filed_issues: expected number[]');
  }

  return errors;
}

function validateReviewer(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, REVIEWER_STATUSES);
  }

  if (!('findings' in data)) {
    errors.push('findings: required');
  } else {
    errors.push(...validateFindingsArray(data.findings, 'findings'));
  }

  if (data.status === 'error') {
    requireField(errors, data, 'error', isString, 'string');
  }

  return errors;
}

export function validateWorker(role: Role, data: unknown): string[] {
  switch (role) {
    case 'planner':
      return validatePlanner(data);
    case 'implementer':
      return validateImplementer(data);
    case 'reviewer':
      return validateReviewer(data);
    default:
      return [`role: unsupported role "${role as string}"`];
  }
}

function parseJsonObject(raw: string, label: string): unknown {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) {
      throw new Error(`${label}: expected JSON object`);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

function extractFencedJson(text: string): unknown | null {
  const match = text.match(/```json\s*\n([\s\S]*?)\n```/i);
  if (!match) {
    return null;
  }
  try {
    return parseJsonObject(match[1].trim(), 'fenced json block');
  } catch {
    return null;
  }
}

function findBalancedObjectStrings(text: string): string[] {
  const objects: string[] = [];

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          objects.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }

  return objects;
}

function extractBareObject(text: string): unknown | null {
  const candidates = findBalancedObjectStrings(text);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return parseJsonObject(candidates[i], 'bare object');
    } catch {
      // try earlier candidate
    }
  }
  return null;
}

export function extractWorkerJson(text: string): unknown {
  const fenced = extractFencedJson(text);
  if (fenced !== null) {
    return fenced;
  }

  const bare = extractBareObject(text);
  if (bare !== null) {
    return bare;
  }

  throw new Error('no worker JSON found in text');
}

export function resolveRole(input: HookInput): Role | null {
  if (input.subagent_type && input.subagent_type in ROLE_FROM_TYPE) {
    return ROLE_FROM_TYPE[input.subagent_type];
  }

  const haystack = [input.description, input.task].filter(Boolean).join(' ');
  const match = haystack.match(ROLE_PATTERN);
  if (match) {
    return match[1].toLowerCase() as Role;
  }

  return null;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function readTranscriptTail(path: string, maxBytes = 64_000): string | null {
  try {
    const stat = fs.statSync(path);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(path, 'r');
    try {
      const length = stat.size - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function extractFromHookInput(input: HookInput): unknown {
  const summary = input.summary ?? '';

  try {
    return extractWorkerJson(summary);
  } catch {
    // fall through to transcript scan
  }

  if (input.agent_transcript_path) {
    const tail = readTranscriptTail(input.agent_transcript_path);
    if (tail) {
      return extractWorkerJson(tail);
    }
  }

  throw new Error('no worker JSON found in summary or transcript');
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
        '       bun run scripts/validate-worker-json.ts --role <planner|implementer|reviewer> (--file <path> | --json <string>)',
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
