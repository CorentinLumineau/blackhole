import { QUEUE_STATUSES } from './queue.ts';
import { scopeEntryFor } from './record.ts';
import type {
  BoardItem,
  BoardStage,
  PrSignal,
  QueueIssue,
  ReadyToMergeItem,
  ScopeEntry,
  StageCounts,
  StatusItem,
  StatusReport,
  StreamConfig,
  Tone,
} from './types.ts';

// The stage board of the status page: every queue entry, plus every open PR no entry names, as one
// card with a stage, a one-line status and a status colour. Pure: the forge signals are an input,
// and without them (`--no-gh`, a failed read, past the cap) a PR card says "not checked".

export const DEFAULT_STREAM = 'All work';
const DEFAULT_LABEL_PREFIX = 'stream:';
const STATUS_MAX = 60;
const TITLE_MAX = 70;

export type BoardInput = {
  issues: Record<string, QueueIssue>;
  /** PRs delivered at LGTM or held for the owner (`ready_to_merge`). */
  readyToMerge: ReadyToMergeItem[];
  /** Owner gates (`waiting_on_owner`), with the detail the owner reads. */
  ownerItems: Array<StatusItem & { detail: string }>;
  /** Issues whose blocked reason class is a merge conflict. */
  mergeConflicts: Set<number>;
  untrackedPrs: Array<{ pr: number; title: string }> | null;
  scope: ScopeEntry[];
  /** Per-PR forge signals; null when the forge was not read this render. */
  signals: Record<number, PrSignal> | null;
  streams?: StreamConfig;
  prUrl: (pr: number) => string | null;
  issueUrl: (issue: number) => string | null;
};

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A card title: the conventional-commit prefix dropped, the first letter raised, clipped. */
export function cardTitle(title: string): string {
  const t = title.replace(/^(WIP:\s*)?[a-z]+(\([^)]*\))?!?:\s*/, '').trim();
  return clip(t.charAt(0).toUpperCase() + t.slice(1), TITLE_MAX);
}

/** The first clause of a note, for a one-line status. A dot ends a clause only before a space, so `a.ts` stays whole. */
const firstClause = (text: string): string => clip((text.split(/[;|\n]|\.(?:\s|$)/)[0] ?? '').trim(), STATUS_MAX);

/** The workstream of an item: an override, else the configured source, else the default stream. */
export function streamOf(config: StreamConfig | undefined, issues: Record<string, QueueIssue>, issue: number | null, pr: number | null): string {
  const fallback = config?.default?.trim() || DEFAULT_STREAM;
  for (const ref of [issue, pr]) {
    const named = ref != null ? config?.overrides?.[String(ref)]?.trim() : undefined;
    if (named) return named;
  }
  const entry = issue != null ? issues[String(issue)] : undefined;
  if (!entry || !config?.from) return fallback;
  if (config.from === 'label') {
    const prefix = config.label_prefix ?? DEFAULT_LABEL_PREFIX;
    const label = (entry.labels ?? []).find((l) => l.startsWith(prefix) && l.length > prefix.length);
    return label ? label.slice(prefix.length).trim() || fallback : fallback;
  }
  if (config.from === 'milestone') return entry.milestone?.trim() || fallback;
  if (config.from === 'epic' && entry.epic_parent != null) {
    return issues[String(entry.epic_parent)]?.title?.trim() || `#${entry.epic_parent}`;
  }
  return fallback;
}

const SCOPE_WORD: Record<string, string> = { parked: 'parked', deferred: 'deferred', out: 'out of scope', blocked_upstream: 'blocked upstream' };

const PHASE_WORD: Record<string, string> = { handle: 'routing', plan: 'planning', implement: 'implementing', review: 'in review' };

type Placement = { stage: BoardStage; status: string; tone: Tone };

/** Where a PR stands, from the forge signal when there is one, else from the queue with "not checked". */
export function prPlacement(
  signal: PrSignal | undefined,
  queue: { delivered: boolean; heldFor?: string; phase?: string | null; reviewIteration?: number },
): Placement {
  const held = queue.heldFor !== undefined ? `held for you${queue.heldFor ? ` (${queue.heldFor})` : ''}` : null;
  if (!signal) {
    if (queue.delivered) return { stage: 'ready', status: `${held ?? 'LGTM: merge'} · CI not checked`, tone: held ? 'warn' : 'ok' };
    const where = queue.phase === 'review' ? `in review${queue.reviewIteration ? ` (round ${queue.reviewIteration})` : ''}` : PHASE_WORD[queue.phase ?? ''] ?? 'open';
    return { stage: 'review', status: `${where} · CI not checked`, tone: '' };
  }
  if (signal.mergeable === false) return { stage: 'blocked', status: 'conflict with its base', tone: 'bad' };
  if (signal.ci === 'failing') return { stage: 'blocked', status: clip(`CI failing: ${signal.failing.slice(0, 2).join(', ')}`, STATUS_MAX), tone: 'bad' };
  const lgtm = signal.review === 'LGTM' || queue.delivered;
  if (lgtm && signal.ci === 'green') return { stage: 'ready', status: held ? `LGTM, CI green: ${held}` : 'LGTM, CI green: merge', tone: held ? 'warn' : 'ok' };
  if (lgtm) return { stage: 'review', status: signal.ci === 'running' ? 'LGTM, CI running' : 'LGTM, no CI yet', tone: 'ok' };
  if (signal.review === 'NEEDS_CHANGES' || signal.review === 'CRITICAL_ISSUES') return { stage: 'review', status: 'changes requested', tone: '' };
  if (signal.review === 'ERROR') return { stage: 'review', status: 'reviewer errored', tone: 'bad' };
  return { stage: 'review', status: signal.ci === 'running' ? 'waiting for review, CI running' : 'waiting for review', tone: '' };
}

function issuePlacement(num: number, issue: QueueIssue, input: BoardInput, ready: Map<number, ReadyToMergeItem>, owner: Map<number, string>): Placement {
  if (issue.status === 'merged' || issue.status === 'closed') return { stage: 'done', status: '', tone: 'ok' };
  const scoped = scopeEntryFor(input.scope, num) ?? scopeEntryFor(input.scope, issue.pr ?? null);
  if (scoped && scoped.kind !== 'in') {
    const status = clip(`${SCOPE_WORD[scoped.kind]}${scoped.reason ? `: ${scoped.reason}` : ''}`, STATUS_MAX);
    return { stage: scoped.kind === 'blocked_upstream' ? 'blocked' : 'parked', status, tone: '' };
  }
  if (!(QUEUE_STATUSES as readonly string[]).includes(String(issue.status))) {
    return { stage: 'blocked', status: issue.status == null ? 'no queue status' : clip(`unknown queue status "${issue.status}"`, STATUS_MAX), tone: 'bad' };
  }
  const ownerDetail = owner.get(num);
  if (ownerDetail !== undefined) return { stage: 'you', status: clip(ownerDetail, STATUS_MAX), tone: 'warn' };
  if (issue.status === 'in-flight') {
    if (issue.pr == null) return { stage: 'active', status: `${PHASE_WORD[issue.phase ?? ''] ?? 'in flight'}, no PR yet`, tone: '' };
    const item = ready.get(num);
    return prPlacement(input.signals?.[issue.pr], {
      delivered: item !== undefined,
      heldFor: item?.held_for,
      phase: issue.phase,
      reviewIteration: issue.review_iteration,
    });
  }
  if (issue.status === 'blocked') {
    const why = issue.notes?.trim() ? firstClause(issue.notes) : issue.depends_on?.length ? `waits for #${issue.depends_on.join(', #')}` : 'blocked';
    return { stage: 'blocked', status: why, tone: input.mergeConflicts.has(num) ? 'bad' : '' };
  }
  return { stage: 'todo', status: '', tone: '' };
}

const STAGE_ORDER: Record<BoardStage, number> = { ready: 0, review: 1, active: 2, blocked: 3, you: 4, todo: 5, parked: 6, done: 7 };
const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, ok: 2, info: 3, '': 4 };

/** Every card, sorted by stage, then by tone (worst first), then newest reference first. */
export function buildBoard(input: BoardInput): BoardItem[] {
  const ready = new Map(input.readyToMerge.map((i) => [i.issue, i]));
  const owner = new Map(input.ownerItems.map((i) => [i.issue, i.detail]));
  const cards: BoardItem[] = [];
  for (const [key, issue] of Object.entries(input.issues)) {
    const num = Number(key);
    if (!Number.isInteger(num)) continue;
    const pr = issue.pr ?? null;
    const place = issuePlacement(num, issue, input, ready, owner);
    cards.push({
      ...place,
      ref: pr ?? num,
      kind: pr != null ? 'pr' : 'issue',
      issue: num,
      pr,
      title: cardTitle(issue.title ?? ''),
      url: (pr != null ? input.prUrl(pr) : null) ?? input.issueUrl(num),
      stream: streamOf(input.streams, input.issues, num, pr),
    });
  }
  for (const p of input.untrackedPrs ?? []) {
    const scoped = scopeEntryFor(input.scope, p.pr);
    const place: Placement =
      scoped && scoped.kind !== 'in'
        ? { stage: scoped.kind === 'blocked_upstream' ? 'blocked' : 'parked', status: clip(`${SCOPE_WORD[scoped.kind]}${scoped.reason ? `: ${scoped.reason}` : ''}`, STATUS_MAX), tone: '' }
        : prPlacement(input.signals?.[p.pr], { delivered: false, phase: null });
    cards.push({ ...place, ref: p.pr, kind: 'pr', issue: null, pr: p.pr, title: cardTitle(p.title), url: input.prUrl(p.pr), stream: streamOf(input.streams, input.issues, null, p.pr) });
  }
  return cards.sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.ref - a.ref);
}

/** An owner gate's step as an imperative: "Owner: approve the plan" reads "Approve the plan". */
const gateAction = (status: string): string => {
  const step = status.replace(/^owner:\s*/i, '').trim() || 'Decide';
  return step.charAt(0).toUpperCase() + step.slice(1);
};

/** What the owner can do now: PRs delivered at LGTM or held for them, then owner gates, then other PRs ready to merge. */
export function buildMoves(board: BoardItem[], delivered: Set<number>): StatusReport['moves'] {
  const move = (c: BoardItem): StatusReport['moves'][number] => ({
    text: c.stage === 'you' ? `${gateAction(c.status)}: #${c.ref} ${c.title}` : c.tone === 'warn' ? `Decide on #${c.ref}: ${c.status}` : `Merge #${c.ref}: ${c.title}`,
    url: c.url,
    ref: c.ref,
  });
  const readyDelivered = board.filter((c) => c.stage === 'ready' && c.issue != null && delivered.has(c.issue));
  const gates = board.filter((c) => c.stage === 'you');
  const otherReady = board.filter((c) => c.stage === 'ready' && !readyDelivered.includes(c));
  return [...readyDelivered, ...gates, ...otherReady].map(move);
}

/** The board's five column counts, plus how many moves wait on the owner. */
export function stageCounts(board: BoardItem[], onYou: number): StageCounts {
  const n = (...stages: BoardStage[]) => board.filter((c) => stages.includes(c.stage)).length;
  const counts = { done: n('done'), in_review: n('ready', 'review', 'active'), blocked: n('blocked'), parked: n('parked'), not_started: n('you', 'todo') };
  return { ...counts, on_you: onYou, total: counts.done + counts.in_review + counts.blocked + counts.parked + counts.not_started };
}

/** One row per workstream: done, in review, left (not parked) and the first card still to move. */
export function buildStreams(board: BoardItem[]): StatusReport['streams'] {
  const names = [...new Set(board.map((c) => c.stream))].sort((a, b) => (a === DEFAULT_STREAM ? 1 : b === DEFAULT_STREAM ? -1 : a.localeCompare(b)));
  return names.map((stream) => {
    const cards = board.filter((c) => c.stream === stream);
    const next = cards.find((c) => c.stage !== 'done' && c.stage !== 'parked');
    return {
      stream,
      done: cards.filter((c) => c.stage === 'done').length,
      in_review: cards.filter((c) => ['ready', 'review', 'active'].includes(c.stage)).length,
      left: cards.filter((c) => ['blocked', 'you', 'todo'].includes(c.stage)).length,
      next: next ? `#${next.ref} ${next.status || 'not started'}` : 'nothing left',
    };
  });
}
