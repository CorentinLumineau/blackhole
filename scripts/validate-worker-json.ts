import * as fs from 'fs';

export type Role = 'planner' | 'implementer' | 'reviewer' | 'router' | 'investigator';

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
const TRACKS = ['quick', 'standard', 'skip', 'design', 'brainstorm'] as const;
const SIZE_ESTIMATES = ['xs', 's', 'm', 'l', 'xl'] as const;
const EXECUTION_MODES = ['standard', 'refactor-strict', 'docs-only'] as const;
const SEVERITIES = ['BLOCK', 'WARN', 'INFO'] as const;
const ROUTE_STATUSES = ['routed', 'error'] as const;
const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'docs'] as const;
const ESCALATION_TRIGGERS = ['failed_attempts', 'touch_paths_overrun'] as const;
const PLAN_MODES = ['skip', 'quick', 'full'] as const;
const TRIGGERS = ['initial', 'clarify-resolved', 'research-landed', 'investigation-landed'] as const;
const INVESTIGATOR_STATUSES = ['complete', 'error'] as const;
const SUB_MODES = ['research', 'investigate'] as const;

const ROLE_FROM_TYPE: Record<string, Role> = {
  planner: 'planner',
  implementer: 'implementer',
  reviewer: 'reviewer',
  router: 'router',
  investigator: 'investigator',
  'blackhole:planner': 'planner',
  'blackhole:implementer': 'implementer',
  'blackhole:reviewer': 'reviewer',
  'blackhole:router': 'router',
  'blackhole:investigator': 'investigator',
};

const ROLE_PATTERN =
  /\b(?:blackhole:)?(planner|implementer|reviewer|router|investigator)\b/i;

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

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isGainEffortScore(value: unknown): value is number {
  return isNumber(value) && value >= 1 && value <= 10;
}

function isEvidence(value: unknown): value is { command: string; result: string } {
  return isObject(value) && isNonEmptyString(value.command) && isNonEmptyString(value.result);
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

function validateBrainstormChild(child: unknown, index: number): string[] {
  const errors: string[] = [];

  if (!isObject(child)) {
    errors.push(`children[${index}]: expected object`);
    return errors;
  }

  requireField(errors, child, 'title', isNonEmptyString, 'non-empty string');
  requireField(errors, child, 'body', isNonEmptyString, 'non-empty string');

  if (!('acceptance_criteria' in child)) {
    errors.push('acceptance_criteria: required');
  } else if (!isStringArray(child.acceptance_criteria) || child.acceptance_criteria.length === 0) {
    errors.push('acceptance_criteria: expected non-empty string[]');
  }

  requireField(errors, child, 'size_estimate', isString, 'string');
  if (isString(child.size_estimate)) {
    pushEnumError(errors, 'size_estimate', child.size_estimate, SIZE_ESTIMATES);
  }

  if (!('suggested_route' in child)) {
    errors.push('suggested_route: required');
  } else if (!isObject(child.suggested_route)) {
    errors.push('suggested_route: expected object');
  } else {
    requireField(errors, child.suggested_route, 'task_type', isString, 'string');
    if (isString(child.suggested_route.task_type)) {
      pushEnumError(errors, 'suggested_route.task_type', child.suggested_route.task_type, TASK_TYPES);
    }
    requireField(errors, child.suggested_route, 'plan_mode', isString, 'string');
    if (isString(child.suggested_route.plan_mode)) {
      pushEnumError(errors, 'suggested_route.plan_mode', child.suggested_route.plan_mode, PLAN_MODES);
    }
  }

  requireField(errors, child, 'gain', isGainEffortScore, 'number (1-10)');
  requireField(errors, child, 'effort', isGainEffortScore, 'number (1-10)');

  return errors.map((error) => `children[${index}].${error}`);
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
    if (data.track === 'design') {
      errors.push('track: design track must never report status ready (ADR-004: design is always blocked)');
    }
    if (data.track === 'brainstorm') {
      requireField(errors, data, 'artifact_path', isString, 'string');
      if (!('children' in data)) {
        errors.push('children: required');
      } else if (!Array.isArray(data.children)) {
        errors.push('children: expected array');
      } else {
        data.children.forEach((child, index) => {
          errors.push(...validateBrainstormChild(child, index));
        });
      }
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
    if ('track' in data) {
      if (!isString(data.track)) {
        errors.push('track: expected string');
      } else {
        pushEnumError(errors, 'track', data.track, TRACKS);
        if (data.track === 'design') {
          requireField(errors, data, 'plan_path', isString, 'string');
        }
        if (data.track === 'brainstorm') {
          requireField(errors, data, 'blocking_question', isNonEmptyString, 'non-empty string');
        }
      }
    }
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
    requireField(
      errors,
      data,
      'evidence',
      isEvidence,
      'object { command: string, result: string } with non-empty command and result',
    );
    if ('execution_mode' in data) {
      if (!isString(data.execution_mode)) {
        errors.push('execution_mode: expected string');
      } else {
        pushEnumError(errors, 'execution_mode', data.execution_mode, EXECUTION_MODES);
      }
    }
  }

  if (data.status === 'blocked') {
    if ('escalation_trigger' in data) {
      if (!isString(data.escalation_trigger)) {
        errors.push('escalation_trigger: expected string');
      } else {
        pushEnumError(errors, 'escalation_trigger', data.escalation_trigger, ESCALATION_TRIGGERS);
      }
    }
  }

  if ('task_type' in data) {
    if (!isString(data.task_type)) {
      errors.push('task_type: expected string');
    } else {
      pushEnumError(errors, 'task_type', data.task_type, TASK_TYPES);
    }
  }

  if ('new_findings' in data && data.new_findings !== undefined && !Array.isArray(data.new_findings)) {
    errors.push('new_findings: expected array');
  }

  if ('filed_issues' in data && data.filed_issues !== undefined && !isNumberArray(data.filed_issues)) {
    errors.push('filed_issues: expected number[]');
  }

  return errors;
}

function isConfidenceScore(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 100;
}

function validateRoute(route: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(route)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, route, 'needs_split', isBoolean, 'boolean');
  requireField(errors, route, 'needs_clarification', isBoolean, 'boolean');
  requireField(errors, route, 'needs_research', isBoolean, 'boolean');
  requireField(errors, route, 'needs_investigation', isBoolean, 'boolean');
  requireField(errors, route, 'needs_design', isBoolean, 'boolean');
  requireField(errors, route, 'needs_brainstorm', isBoolean, 'boolean');

  requireField(errors, route, 'task_type', isString, 'string');
  if (isString(route.task_type)) {
    pushEnumError(errors, `${path}.task_type`, route.task_type, TASK_TYPES);
  }

  requireField(errors, route, 'plan_mode', isString, 'string');
  if (isString(route.plan_mode)) {
    pushEnumError(errors, `${path}.plan_mode`, route.plan_mode, PLAN_MODES);
  }

  requireField(errors, route, 'security_review_required', isBoolean, 'boolean');
  requireField(errors, route, 'docs_impact', isBoolean, 'boolean');

  if (!('confidence' in route)) {
    errors.push('confidence: required');
  } else if (!isObject(route.confidence)) {
    errors.push('confidence: expected object');
  } else {
    for (const field of ['split', 'design', 'plan_mode', 'security', 'docs', 'brainstorm'] as const) {
      requireField(errors, route.confidence, field, isConfidenceScore, 'number (0-100)');
    }
  }

  requireField(errors, route, 'body_hash', isString, 'string');
  requireField(errors, route, 'computed_at_phase', isString, 'string');
  requireField(errors, route, 'revision', isNumber, 'number');

  return errors;
}

function validateRouter(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, ROUTE_STATUSES);
  }

  if (data.status === 'routed') {
    if (!('route' in data)) {
      errors.push('route: required');
    } else {
      errors.push(...validateRoute(data.route, 'route'));
    }
    requireField(errors, data, 'trigger', isString, 'string');
    if (isString(data.trigger)) {
      pushEnumError(errors, 'trigger', data.trigger, TRIGGERS);
    }
  } else if (data.status === 'error') {
    requireField(errors, data, 'error', isString, 'string');
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

function validateInvestigator(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, INVESTIGATOR_STATUSES);
  }

  if (data.status === 'complete') {
    requireField(errors, data, 'note_path', isString, 'string');
    requireField(errors, data, 'sub_mode', isString, 'string');
    if (isString(data.sub_mode)) {
      pushEnumError(errors, 'sub_mode', data.sub_mode, SUB_MODES);
    }
    requireField(errors, data, 'confidence', isConfidenceScore, 'number (0-100)');
    requireField(errors, data, 'computed_at_revision', isNumber, 'number');
  } else if (data.status === 'error') {
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
    case 'router':
      return validateRouter(data);
    case 'investigator':
      return validateInvestigator(data);
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

export function readTranscriptTail(path: string, maxBytes = 64_000): string | null {
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

export function extractFromHookInput(input: HookInput): unknown {
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
        '       bun run scripts/validate-worker-json.ts --role <planner|implementer|reviewer|router|investigator> (--file <path> | --json <string>)',
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
