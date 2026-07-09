import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  groupIssuesByPhase,
  parseCheckpointFrontmatter,
  type QueueJson,
} from './campaign-status';
import {
  extractWorkerJson,
  resolveRole,
  validateWorker,
  type HookInput,
  type Role,
} from './validate-worker-json';

export type CampaignAgent =
  | 'orchestrator'
  | 'router'
  | 'planner'
  | 'implementer'
  | 'reviewer'
  | 'investigator';

export type ResumeReason = 'orchestrator_turn_complete' | 'stale_barrier';

export type ResumeRequest = {
  version: 1;
  requested_at: string;
  reason: ResumeReason;
  target: 'coordinator';
  dedupe_key: string;
  coalesce_until: string;
  stopping_agent: string;
  queue_refreshed_at: string;
  orchestrator_turn_id: number | null;
};

export type ResumeHookResult = {
  action: 'none' | 'file_only' | 'file_and_doorbell';
  resumeRequest?: ResumeRequest;
};

const CAMPAIGN_AGENTS = new Set<CampaignAgent>([
  'orchestrator',
  'router',
  'planner',
  'implementer',
  'reviewer',
  'investigator',
]);

const WORKER_AGENTS = new Set<CampaignAgent>([
  'router',
  'planner',
  'implementer',
  'reviewer',
  'investigator',
]);

const AGENT_FROM_TYPE: Record<string, CampaignAgent> = {
  orchestrator: 'orchestrator',
  router: 'router',
  planner: 'planner',
  implementer: 'implementer',
  reviewer: 'reviewer',
  investigator: 'investigator',
  'blackhole:orchestrator': 'orchestrator',
  'blackhole:router': 'router',
  'blackhole:planner': 'planner',
  'blackhole:implementer': 'implementer',
  'blackhole:reviewer': 'reviewer',
  'blackhole:investigator': 'investigator',
};

const AGENT_PATTERN =
  /\b(?:blackhole:)?(orchestrator|router|planner|implementer|reviewer|investigator)\b/i;

const USER_GATE_PATTERN = /awaiting-user|awaiting-plan|awaiting-design/i;

const COALESCE_MS = 5_000;

export const DOORBELL_MESSAGE =
  'Blackhole: pending resume-request.json. Run coordinator turn flow — bun run status (full dashboard), then resume orchestrator with interrupt:false if work remains and queue is not user-blocked. Ack resume-request.json after resume.';

export function resolveCampaignAgent(input: HookInput): CampaignAgent | null {
  if (input.subagent_type && input.subagent_type in AGENT_FROM_TYPE) {
    return AGENT_FROM_TYPE[input.subagent_type];
  }

  const haystack = [input.description, input.task].filter(Boolean).join(' ');
  const match = haystack.match(AGENT_PATTERN);
  if (match) {
    return match[1].toLowerCase() as CampaignAgent;
  }

  return null;
}

export function extractCheckpointSection(body: string, heading: string): string {
  const marker = `## ${heading}`;
  if (!body.includes(marker)) return '';
  return body.split(marker)[1]?.split(/^## /m)[0]?.trim() ?? '';
}

export function checkpointReadySetNonEmpty(checkpointBody: string): boolean {
  const section = extractCheckpointSection(checkpointBody, 'Ready set');
  if (!section) return false;
  return /\d+/.test(section);
}

export function checkpointInFlightWorkersNonEmpty(checkpointBody: string): boolean {
  const section = extractCheckpointSection(checkpointBody, 'In-flight workers');
  if (!section) return false;
  return section.split('\n').some((line) => line.trim().startsWith('-'));
}

export function hasUserGate(issues: QueueJson['issues'] = {}): boolean {
  for (const issue of Object.values(issues)) {
    const notes = issue.notes ?? '';
    if (!USER_GATE_PATTERN.test(notes)) continue;
    if (issue.status === 'blocked' || issue.status === 'in-flight') {
      return true;
    }
  }
  return false;
}

export function hasWorkRemaining(queue: QueueJson, checkpointBody = ''): boolean {
  const issues = queue.issues ?? {};
  const { ready, inFlight } = groupIssuesByPhase(issues);
  if (ready.length > 0 || inFlight.length > 0) return true;
  if (checkpointReadySetNonEmpty(checkpointBody)) return true;
  if (checkpointInFlightWorkersNonEmpty(checkpointBody)) return true;
  return false;
}

export function workerArtifactsSatisfyGate(input: HookInput, role: Role): boolean {
  try {
    const summary = input.summary ?? '';
    const workerJson = extractWorkerJson(summary);
    return validateWorker(role, workerJson).length === 0;
  } catch {
    return false;
  }
}

export function detectStaleBarrier(
  input: HookInput,
  agent: CampaignAgent,
  checkpointBody: string,
): boolean {
  if (!WORKER_AGENTS.has(agent)) return false;
  if (!checkpointInFlightWorkersNonEmpty(checkpointBody)) return false;

  const role = resolveRole(input);
  if (!role) return false;
  return workerArtifactsSatisfyGate(input, role);
}

export function buildDedupeKey(
  reason: ResumeReason,
  orchestratorTurnId: number | null,
  queue: QueueJson,
): string {
  if (reason === 'orchestrator_turn_complete') {
    return `turn-${orchestratorTurnId ?? 0}`;
  }

  const issueNums = Object.keys(queue.issues ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const hash = createHash('sha256').update(issueNums.join(',')).digest('hex').slice(0, 8);
  return `stale-wave-${orchestratorTurnId ?? 0}-${hash}`;
}

export function readResumeRequest(filePath: string): ResumeRequest | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ResumeRequest;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function mergeResumeRequest(
  existing: ResumeRequest | null,
  next: ResumeRequest,
  now: Date,
): ResumeRequest {
  if (
    existing &&
    existing.dedupe_key === next.dedupe_key &&
    new Date(existing.coalesce_until).getTime() > now.getTime()
  ) {
    return {
      ...existing,
      requested_at: next.requested_at,
      coalesce_until: next.coalesce_until,
      stopping_agent: next.stopping_agent,
      queue_refreshed_at: next.queue_refreshed_at,
      orchestrator_turn_id: next.orchestrator_turn_id,
      reason: next.reason,
    };
  }
  return next;
}

export function writeResumeRequestAtomic(campaignDir: string, record: ResumeRequest): void {
  const target = path.join(campaignDir, 'resume-request.json');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

export function buildResumeRequest(opts: {
  reason: ResumeReason;
  stoppingAgent: CampaignAgent;
  queue: QueueJson;
  orchestratorTurnId: number | null;
  now?: Date;
}): ResumeRequest {
  const now = opts.now ?? new Date();
  const coalesceUntil = new Date(now.getTime() + COALESCE_MS);
  return {
    version: 1,
    requested_at: now.toISOString(),
    reason: opts.reason,
    target: 'coordinator',
    dedupe_key: buildDedupeKey(opts.reason, opts.orchestratorTurnId, opts.queue),
    coalesce_until: coalesceUntil.toISOString(),
    stopping_agent: opts.stoppingAgent,
    queue_refreshed_at: opts.queue.refreshed_at ?? now.toISOString(),
    orchestrator_turn_id: opts.orchestratorTurnId,
  };
}

export function evaluateResumeHook(
  input: HookInput,
  campaignDir: string,
  now: Date = new Date(),
): ResumeHookResult {
  if (input.status === 'error' || input.status === 'aborted') {
    return { action: 'none' };
  }

  const agent = resolveCampaignAgent(input);
  if (!agent || !CAMPAIGN_AGENTS.has(agent)) {
    return { action: 'none' };
  }

  const queuePath = path.join(campaignDir, 'queue.json');
  if (!fs.existsSync(queuePath)) {
    return { action: 'none' };
  }

  let queue: QueueJson;
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as QueueJson;
  } catch {
    return { action: 'none' };
  }

  const checkpointPath = path.join(campaignDir, 'campaign-checkpoint.md');
  let checkpointBody = '';
  if (fs.existsSync(checkpointPath)) {
    checkpointBody = fs.readFileSync(checkpointPath, 'utf-8');
  }
  const checkpoint = parseCheckpointFrontmatter(checkpointBody);
  const orchestratorTurnId = checkpoint.orchestrator_turn_id ?? null;

  if (hasUserGate(queue.issues)) {
    return { action: 'none' };
  }

  const staleBarrier =
    WORKER_AGENTS.has(agent) && detectStaleBarrier(input, agent, checkpointBody);

  if (!hasWorkRemaining(queue, checkpointBody) && !staleBarrier) {
    return { action: 'none' };
  }

  const reason: ResumeReason =
    agent === 'orchestrator' ? 'orchestrator_turn_complete' : 'stale_barrier';

  if (reason === 'stale_barrier' && !staleBarrier) {
    return { action: 'none' };
  }

  const resumeRequest = buildResumeRequest({
    reason,
    stoppingAgent: agent,
    queue,
    orchestratorTurnId,
    now,
  });

  const existing = readResumeRequest(path.join(campaignDir, 'resume-request.json'));
  const merged = mergeResumeRequest(existing, resumeRequest, now);
  writeResumeRequestAtomic(campaignDir, merged);

  if (agent === 'orchestrator') {
    return { action: 'file_and_doorbell', resumeRequest: merged };
  }

  return { action: 'file_only', resumeRequest: merged };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function runHook(campaignDir: string): Promise<number> {
  try {
    let raw: string;
    try {
      raw = await readStdin();
    } catch (error) {
      console.error(
        `resume hook stdin read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }

    if (!raw.trim()) {
      return 0;
    }

    let input: HookInput;
    try {
      input = JSON.parse(raw) as HookInput;
    } catch (error) {
      console.error(
        `resume hook stdin JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }

    const result = evaluateResumeHook(input, campaignDir);
    if (result.action === 'file_and_doorbell') {
      console.log(JSON.stringify({ followup_message: DOORBELL_MESSAGE }));
    }

    return 0;
  } catch (error) {
    console.error(`resume hook error: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

function parseCliArgs(argv: string[]) {
  let hook = false;
  let campaignDir: string | null = null;
  let inputFile: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hook') {
      hook = true;
    } else if (arg === '--campaign-dir' && argv[i + 1]) {
      campaignDir = argv[++i];
    } else if (arg === '--input' && argv[i + 1]) {
      inputFile = argv[++i];
    }
  }

  return { hook, campaignDir, inputFile };
}

async function main() {
  const root = path.resolve(import.meta.dirname, '..');
  const argv = process.argv.slice(2);
  const { hook, campaignDir, inputFile } = parseCliArgs(argv);
  const resolvedCampaignDir = campaignDir
    ? path.isAbsolute(campaignDir)
      ? campaignDir
      : path.join(root, campaignDir)
    : path.join(root, '.blackhole');

  if (hook || (argv.length === 0 && !process.stdin.isTTY)) {
    process.exit(await runHook(resolvedCampaignDir));
  }

  if (inputFile) {
    const input = JSON.parse(fs.readFileSync(inputFile, 'utf-8')) as HookInput;
    const result = evaluateResumeHook(input, resolvedCampaignDir);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  console.error(
    'Usage: bun run scripts/campaign-resume-signal.ts --hook\n' +
      '       bun run scripts/campaign-resume-signal.ts --campaign-dir <path> --input <hook.json>',
  );
  process.exit(1);
}

if (import.meta.main) {
  main();
}
