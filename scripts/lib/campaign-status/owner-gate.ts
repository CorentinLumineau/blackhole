import { runGhApi } from '../forge-adapter/cli.ts';
import { waitReason } from './blocked-classes.ts';
import { PARK_REASON, type PendingDecision } from './pending-decisions.ts';
import { isSameRepoKey } from './queue.ts';
import type { QueueIssue } from './types.ts';

// The decide round's forge-side decisions (`decision-parking.md` § Decide round): open PRs held by
// the consumer repo's owner gate, and blocked worker returns that carry an owner question. Both are
// read-only and fail-open: a read that fails is reported as unchecked, never as "none waiting".
// Neither is ever written to `pending-decisions.json`; their ids (`PR-<n>`, `BR-<n>`) say where the
// answer goes. The gate's labels are the consumer's (`decisions.owner_gate`, `config-template.md`):
// the plugin knows only that a PR carrying the pending label and not the approved one waits on the owner.

/** The literal the report carries when the gate is configured but its PRs could not be read. */
export const OWNER_GATE_UNCHECKED = 'owner-gated PRs unchecked — forge unavailable';

/** `config.json` `decisions.owner_gate`: the labels the consumer repo's owner gate uses. */
export type OwnerGateConfig = { pending_label: string; approved_label: string };

/**
 * The configured gate, `null` when the block is absent (inert: nothing collected, nothing said), or
 * the reason it is unusable when present but malformed.
 */
export function ownerGateConfig(config: unknown): OwnerGateConfig | null | { invalid: string } {
  const block = ((config as { decisions?: unknown } | null)?.decisions as { owner_gate?: unknown } | null | undefined)?.owner_gate;
  if (block === undefined || block === null) return null;
  const b = block as Record<string, unknown>;
  const ok = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
  if (typeof block !== 'object' || !ok(b.pending_label) || !ok(b.approved_label)) {
    return { invalid: 'decisions.owner_gate needs pending_label and approved_label' };
  }
  return { pending_label: b.pending_label.trim(), approved_label: b.approved_label.trim() };
}

export type OwnerGatePr = { number: number; title: string; labels: string[] };
export type OwnerGateRead = { status: 'ok'; prs: OwnerGatePr[] } | { status: 'unavailable'; reason: string };
/** Reads the open PRs carrying `gate.pending_label` in `repo`. Sync, so `campaign-record.ts` stays sync. */
export type OwnerGateReader = (repo: { repo?: unknown; forge?: unknown }, gate: OwnerGateConfig) => OwnerGateRead;

const PAGE = 100;
const MAX_PAGES = 10;
const FORGE_TIMEOUT_MS = 20_000;

type RestIssueRow = { number?: unknown; title?: unknown; labels?: unknown; pull_request?: unknown };

const labelNames = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw.map((l) => (typeof l === 'string' ? l : (l as { name?: unknown })?.name)).filter((n): n is string => typeof n === 'string')
    : [];

/** GitHub REST: open issues carrying the pending label, keeping the pull requests. Any other forge, or no `repo`, is unavailable without spawning. */
export const systemOwnerGateReader: OwnerGateReader = (config, gate) => {
  if (typeof config.repo !== 'string' || !config.repo.includes('/')) return { status: 'unavailable', reason: 'no repo in config.json' };
  if (config.forge !== undefined && config.forge !== 'github') return { status: 'unavailable', reason: `not read on ${String(config.forge)}` };
  const prs: OwnerGatePr[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const endpoint = `repos/${config.repo}/issues?state=open&labels=${encodeURIComponent(gate.pending_label)}&per_page=${PAGE}&page=${page}`;
    const result = runGhApi('GET', endpoint, undefined, { timeoutMs: FORGE_TIMEOUT_MS });
    if (result.status !== 0) return { status: 'unavailable', reason: result.stderr.trim().split('\n')[0] || 'gh api failed' };
    let rows: unknown;
    try {
      rows = JSON.parse(result.stdout);
    } catch {
      return { status: 'unavailable', reason: 'unreadable forge reply' };
    }
    if (!Array.isArray(rows)) return { status: 'unavailable', reason: 'unreadable forge reply' };
    for (const r of rows as RestIssueRow[]) {
      if (r.pull_request == null || !Number.isInteger(r.number)) continue;
      prs.push({ number: r.number as number, title: typeof r.title === 'string' ? r.title : '', labels: labelNames(r.labels) });
    }
    if (rows.length < PAGE) return { status: 'ok', prs };
  }
  return { status: 'unavailable', reason: `more than ${PAGE * MAX_PAGES} open PRs carry ${gate.pending_label}` };
};

/**
 * True when the PR still waits on the owner: it carries the pending label and not the approved one.
 * Whether an approval is still current (who added it, and whether the head moved since) is the
 * consumer repo's merge gate to judge, not the plugin's.
 */
export const awaitsOwner = (pr: OwnerGatePr, gate: OwnerGateConfig): boolean =>
  pr.labels.includes(gate.pending_label) && !pr.labels.includes(gate.approved_label);

const sameRepo = (issues: Record<string, QueueIssue>): Array<[number, QueueIssue]> =>
  Object.entries(issues)
    .filter(([n]) => isSameRepoKey(n))
    .map(([n, i]) => [Number(n), i]);

/** Queue issues that list any of `items` in `depends_on`. */
const dependents = (queue: Array<[number, QueueIssue]>, items: number[]): number[] =>
  queue.filter(([, i]) => (i.depends_on ?? []).some((d) => items.includes(d))).map(([n]) => n);

const uniqueSorted = (ns: number[]): number[] => [...new Set(ns)].sort((a, b) => a - b);

/**
 * One Approve / Hold question per PR that `awaitsOwner`. It blocks the PR, the queue
 * issues it implements or that stack on it, and the issues that depend on those.
 */
export function ownerGateDecisions(
  prs: OwnerGatePr[],
  gate: OwnerGateConfig,
  issues: Record<string, QueueIssue> | null,
  nowIso: string,
): PendingDecision[] {
  const queue = sameRepo(issues ?? {});
  return prs.filter((pr) => awaitsOwner(pr, gate)).map((pr) => {
    const subject = `PR #${pr.number}`;
    const implementing = queue.filter(([, i]) => i.pr === pr.number || i.stacked_on_pr === pr.number).map(([n]) => n);
    return {
      id: `PR-${pr.number}`,
      question: `Approve owner-gated ${subject}${pr.title ? ` (${pr.title})` : ''}?`,
      options: [
        { label: 'Approve', consequence: `the orchestrator adds ${gate.approved_label} on the current head of ${subject}, citing this answer` },
        { label: 'Hold', consequence: `${subject} stays gated; nothing is labelled` },
      ],
      recommended: 0,
      blocks: uniqueSorted([pr.number, ...implementing, ...dependents(queue, implementing)]),
      gate: 'owner-gate',
      created_at: nowIso,
    };
  });
}

/**
 * One question per blocked queue issue only the owner can clear (`waitReason(...).owner`: an
 * `awaiting-*` gate or a `blocked-escalated:` note), unless it is already parked: its note is
 * `PARK_REASON`, or a parked decision lists it in `blocks`.
 */
export function blockedReturnDecisions(issues: Record<string, QueueIssue> | null, parked: PendingDecision[], nowIso: string): PendingDecision[] {
  const all = issues ?? {};
  const queue = sameRepo(all);
  const parkedItems = new Set(parked.flatMap((d) => d.blocks));
  return queue
    .filter(([n, i]) => i.status === 'blocked' && !parkedItems.has(n) && !(i.notes ?? '').trim().startsWith(PARK_REASON) && waitReason(i, all).owner)
    .map(([n, i]) => {
      const subject = `#${n}`;
      const note = (i.notes ?? '').replace(/^\s*(awaiting-[\w-]+|blocked-escalated):?\s*/, '').trim() || (i.notes ?? '').trim();
      return {
        id: `BR-${n}`,
        question: `${subject}${i.title ? ` (${i.title})` : ''} waits on you: ${note}`,
        options: [
          { label: 'Approve', consequence: `the orchestrator resumes ${subject} with this answer and promotes it blocked → ready` },
          { label: 'Hold', consequence: `${subject} stays blocked` },
        ],
        recommended: 0,
        blocks: uniqueSorted([n, ...dependents(queue, [n])]),
        gate: 'blocked-return',
        created_at: nowIso,
      };
    });
}
