import { formatMergeNextItem, mergeNextOrder, trunkFixIssues } from '../merge-next.ts';
import { when } from './budget.ts';
import { DONE_STATUSES } from './queue.ts';
import type { BudgetPanel, QueueIssue } from './types.ts';

// The decide round's report (`decision-parking.md` § Decide round): what ran since the last round,
// measured against the baseline that round recorded in `decide-baseline.json`, and the wake-ups the
// campaign re-arms for itself (`keep-awake.md` § Wake-ups). Pure: `scripts/campaign-record.ts` does the I/O.

/** `.blackhole/decide-baseline.json`: written by every `decide`, read by the next one. */
export const DECIDE_BASELINE_FILE = 'decide-baseline.json';

/**
 * What was true at the last decide round, so the next report can say what changed. `done` is null
 * when `queue.json` was absent then: nothing was measured, which is not "nothing was done".
 */
export type DecideBaseline = { at: string; done: number[] | null; weekly_pct: number | null };

/** A well-formed baseline, or null (absent, a hand edit, or a malformed file): the report then says "not measured". */
export function parseDecideBaseline(raw: unknown): DecideBaseline | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  const atOk = typeof b.at === 'string' && !Number.isNaN(Date.parse(b.at));
  const doneOk = b.done === null || (Array.isArray(b.done) && b.done.every(Number.isInteger));
  const weeklyOk = b.weekly_pct === null || typeof b.weekly_pct === 'number';
  return atOk && doneOk && weeklyOk ? { at: b.at as string, done: b.done as number[] | null, weekly_pct: b.weekly_pct as number | null } : null;
}

/**
 * The baseline retired sleep mode left in `config.json` (`sleep_mode.since` + `sleep_mode.baseline`),
 * used once when no decide round has run yet, so a campaign that was away at the upgrade still gets
 * its away report on the first `decide`.
 */
export function legacySleepBaseline(config: unknown): DecideBaseline | null {
  const block = (config as { sleep_mode?: { since?: unknown; baseline?: { done?: unknown; weekly_pct?: unknown } } } | null)?.sleep_mode;
  if (!block?.baseline) return null;
  return parseDecideBaseline({ at: block.since, done: block.baseline.done, weekly_pct: block.baseline.weekly_pct });
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

function workDone(baseline: DecideBaseline | null, issues: Record<string, QueueIssue> | null): string {
  if (!baseline) return 'not measured — no earlier decide round';
  if (!baseline.done) return 'not measured — queue.json was absent at the last round';
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

function budgetUsed(b: BudgetPanel, baseline: DecideBaseline | null): string {
  if (!b.probed) return `usage not probed — ${b.reason ?? 'no reading'}`;
  const parts: string[] = [];
  if (b.weekly_pct !== null) {
    const start = baseline?.weekly_pct;
    const delta = typeof start === 'number' ? ` (+${Number((b.weekly_pct - start).toFixed(2))} points since the last round)` : '';
    parts.push(`weekly ${b.weekly_pct}%${delta}`);
  }
  if (b.five_hour_pct !== null) parts.push(`5-hour ${b.five_hour_pct}%`);
  return parts.join(', ') || 'no usage window read';
}

const waiting = (pending: number): string => (pending ? `${pending}, asked next` : 'none');

/** The report printed ahead of the decide round: what ran since the last round, then the decisions waiting. */
export function buildDecideReport(input: {
  baseline: DecideBaseline | null;
  issues: Record<string, QueueIssue> | null;
  budget: BudgetPanel;
  pending: number;
}): string {
  return [
    '## Since the last decide round',
    '',
    input.baseline ? `- Last round: ${when(input.baseline.at)}.` : '- Last round: none recorded.',
    `- Issues finished: ${workDone(input.baseline, input.issues)}.`,
    `- Open PRs in merge order: ${openPrs(input.issues)}.`,
    `- Weekly points used: ${budgetUsed(input.budget, input.baseline)}.`,
    `- Decisions waiting for you: ${waiting(input.pending)}.`,
    '',
  ].join('\n');
}
