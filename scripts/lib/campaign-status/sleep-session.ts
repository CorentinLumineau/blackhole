import { formatMergeNextItem, mergeNextOrder, trunkFixIssues } from '../merge-next.ts';
import { when } from './budget.ts';
import { DONE_STATUSES } from './queue.ts';
import type { BudgetPanel, QueueIssue } from './types.ts';

// Sleep mode, the owner's absence (`sleep-mode.md`): the `sleep_mode` block the toggle writes, the
// wake-ups the campaign re-arms for itself while nobody is watching, and the reports the owner reads
// before a decision round (`decision-parking.md`). Pure: `scripts/campaign-record.ts` does the I/O.

/**
 * What was true when sleep mode went on, so the wake-up report can say what changed. `done` is
 * null when `queue.json` was absent then: nothing was measured, which is not "nothing was done".
 */
export type SleepBaseline = { done: number[] | null; weekly_pct: number | null };
type SleepBlock = { enabled?: unknown; since?: unknown; baseline?: SleepBaseline };
type WithSleep = Record<string, unknown> & { sleep_mode?: SleepBlock };

const block = (config: WithSleep): SleepBlock => config.sleep_mode ?? {};

/** Turns sleep mode on. Already on ⇒ unchanged, so the first `since` and baseline stay. */
export function sleepOn(config: WithSleep, nowIso: string, baseline: SleepBaseline): WithSleep {
  if (block(config).enabled === true) return config;
  return { ...config, sleep_mode: { ...block(config), enabled: true, since: nowIso, baseline } };
}

/** Turns sleep mode off and drops what only a sleeping session needs. */
export function sleepOff(config: WithSleep): WithSleep {
  const { since: _since, baseline: _baseline, ...rest } = block(config);
  return { ...config, sleep_mode: { ...rest, enabled: false } };
}

/** `since` and `baseline` of the current sleep, each null when not recorded (a hand edit, or an older campaign). */
export function readSleepSession(config: WithSleep): { since: string | null; baseline: SleepBaseline | null } {
  const b = block(config);
  const since = typeof b.since === 'string' && !Number.isNaN(Date.parse(b.since)) ? b.since : null;
  const done = b.baseline?.done;
  const weekly = b.baseline?.weekly_pct;
  const ok = (done === null || (Array.isArray(done) && done.every(Number.isInteger))) && (weekly === null || typeof weekly === 'number');
  return { since, baseline: ok ? (b.baseline as SleepBaseline) : null };
}

/** Issue numbers whose queue status is done (`DONE_STATUSES`), ascending. */
export const doneIssues = (issues: Record<string, QueueIssue>): number[] =>
  Object.entries(issues)
    .filter(([, i]) => DONE_STATUSES.includes(i.status ?? ''))
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);

/** Same interval as the routine check-in of an outstanding CI wait (`project-thread-mode.md` § Scheduling: routines). */
export const CI_CHECK_IN_MINUTES = 20;

export type WakeReason = 'ci-check-in' | 'five-hour-reset' | 'weekly-reset';
export type WakeUp = { at: string; reasons: WakeReason[]; refs: number[]; wake_peers: boolean };

const toMinute = (ms: number): string => new Date(Math.floor(ms / 60_000) * 60_000).toISOString();

/**
 * The wake-ups to keep armed, soonest first, one per minute: each future usage-window reset, and
 * one CI check-in for the PRs in flight. A manager (`usage_budget.coordination.role`) wakes its
 * peers on a reset, since a reset frees slots they wait for. A usage stop's own `wake_at` is not
 * listed: `phase-stop.md` § Usage stop arms exactly that one.
 */
export function planWakeUps(input: { budget: BudgetPanel; issues: Record<string, QueueIssue>; role: string; nowIso: string }): WakeUp[] {
  const now = Date.parse(input.nowIso);
  const raw: Array<{ ms: number; reason: WakeReason; refs: number[] }> = [];
  const ci = Object.entries(input.issues)
    .filter(([, i]) => i.status === 'in-flight' && i.pr != null)
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);
  if (ci.length) raw.push({ ms: now + CI_CHECK_IN_MINUTES * 60_000, reason: 'ci-check-in', refs: ci });
  const resets: Array<[string | null, WakeReason]> = [
    [input.budget.probed ? input.budget.five_hour_resets_at : null, 'five-hour-reset'],
    [input.budget.probed ? input.budget.resets_at : null, 'weekly-reset'],
  ];
  for (const [at, reason] of resets) if (at && Date.parse(at) > now) raw.push({ ms: Date.parse(at), reason, refs: [] });
  const byMinute = new Map<string, WakeUp>();
  for (const r of raw.sort((a, b) => a.ms - b.ms)) {
    const at = toMinute(r.ms);
    const w = byMinute.get(at) ?? { at, reasons: [], refs: [], wake_peers: false };
    w.reasons.push(r.reason);
    w.refs = [...new Set([...w.refs, ...r.refs])].sort((a, b) => a - b);
    w.wake_peers ||= input.role === 'manager' && r.reason !== 'ci-check-in';
    byMinute.set(at, w);
  }
  return [...byMinute.values()];
}

const list = (ns: number[]): string => ns.map((n) => `#${n}`).join(', ');
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function workDone(baseline: SleepBaseline | null, issues: Record<string, QueueIssue> | null): string {
  if (!baseline) return 'not measured — no sleep baseline was recorded';
  if (!baseline.done) return 'not measured — queue.json was absent when sleep mode went on';
  if (!issues) return 'not measured — queue.json not read';
  const before = new Set(baseline.done);
  const finished = doneIssues(issues).filter((n) => !before.has(n));
  return finished.length ? `${plural(finished.length, 'issue')} finished — ${list(finished)}` : 'none';
}

function openPrs(issues: Record<string, QueueIssue> | null): string {
  if (!issues) return 'queue.json not read';
  // Trunk-red base fixes merge first, as on the dashboard; issue bodies are not read here, so
  // cross-repo blockers are unknown and the line says so rather than showing them as clear.
  const { items, cycles } = mergeNextOrder(issues, trunkFixIssues(issues));
  const ordered = items.map((item, i) => `${i + 1}. ${formatMergeNextItem(item)}`);
  const loops = cycles.map((c) => `cycle, not ordered: ${list(c)}`);
  const all = [...ordered, ...loops];
  return all.length ? `${all.join('; ')} (cross-repo dependencies not read)` : 'none';
}

function budgetUsed(b: BudgetPanel, baseline: SleepBaseline | null): string {
  if (!b.probed) return `usage not probed — ${b.reason ?? 'no reading'}`;
  const parts: string[] = [];
  if (b.weekly_pct !== null) {
    const start = baseline?.weekly_pct;
    const delta = typeof start === 'number' ? ` (+${Number((b.weekly_pct - start).toFixed(2))} points while away)` : '';
    parts.push(`weekly ${b.weekly_pct}%${delta}`);
  }
  if (b.five_hour_pct !== null) parts.push(`5-hour ${b.five_hour_pct}%`);
  return parts.join(', ') || 'no usage window read';
}

const waiting = (pending: number): string => (pending ? `${pending}, asked next` : 'none');

/**
 * The executive summary printed ahead of the round when the owner was away (`sleep-mode.md` §
 * Wake-up). `stillAway` is set by `decide`, which answers without ending the absence.
 */
export function buildWakeReport(input: {
  since: string | null;
  baseline: SleepBaseline | null;
  issues: Record<string, QueueIssue> | null;
  budget: BudgetPanel;
  pending: number;
  stillAway?: boolean;
}): string {
  return [
    '## While you were away',
    '',
    input.since ? `- Asleep since ${when(input.since)}.` : '- Asleep since: not recorded.',
    `- Work done: ${workDone(input.baseline, input.issues)}.`,
    `- Open PRs in merge order: ${openPrs(input.issues)}.`,
    `- Budget used: ${budgetUsed(input.budget, input.baseline)}.`,
    ...(input.stillAway
      ? ['- Still away: the keep-awake hold and the print-only launch gate stay on until `/blackhole wake`.']
      : []),
    `- Decisions waiting for you: ${waiting(input.pending)}.`,
    '',
  ].join('\n');
}

/** The summary printed ahead of a decision round when the owner is present (`decision-parking.md` § Decide round). */
export function buildDecideReport(input: { issues: Record<string, QueueIssue> | null; budget: BudgetPanel; pending: number }): string {
  return [
    '## Before you decide',
    '',
    `- Open PRs in merge order: ${openPrs(input.issues)}.`,
    `- Usage now: ${budgetUsed(input.budget, null)}.`,
    `- Decisions waiting for you: ${waiting(input.pending)}.`,
    '',
  ].join('\n');
}
