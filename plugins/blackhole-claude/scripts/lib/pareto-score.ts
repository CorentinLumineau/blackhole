import type { QueueJson } from './campaign-status/types.ts';
import { rescoreIssue } from './forge-adapter/pareto-filing.ts';
import type { ForgeAdapter, ForgeIssue } from './forge-adapter/types.ts';
import { paretoLabel, paretoPriority, parseParetoLine, reconcileParetoLabels, upsertRationaleLine, type Pareto } from './pareto.ts';

// Mechanical side of score-on-ingest (`forge-sync.md` § Score on ingest): finds the ready queue
// entries whose issue has no valid `Pareto:` line, and applies the scores the orchestrator's LLM
// judgement returns. The judgement itself is not here. No process or filesystem access.

export type StaleReason = 'unrecorded' | 'edited' | 'aged';
/** A scored issue due a new score: gain/effort/priority are the score it carries, `reason` why it is due. */
export type Rescore = { gain: number; effort: number; priority: number; reason: StaleReason };
export type ScoreRequest = { number: number; title: string; labels: string[]; body: string; rescore?: Rescore };
export type Score = { number: number; gain: number; effort: number; rationale: string };
export type ApplyOutcome = { number: number; result: 'scored' | 'rescored' | 'already-scored' | 'skipped'; reason?: string };

/** A scores file naming one issue twice: each entry would resolve against the same pre-edit issue snapshot. */
export class DuplicateScoreError extends Error {
  constructor(readonly issueNumber: number) {
    super(`duplicate score entries for issue #${issueNumber}`);
    this.name = 'DuplicateScoreError';
  }
}

export const DEFAULT_MAX_AGE_DAYS = 7;
export const ISSUE_LIMIT = 1000;
const DAY_MS = 86_400_000;
const BODY_EXCERPT = 4000;

/**
 * Why a stored score is due a new one, or null when it is current: it has no `scored_at` (scored by
 * hand or before the score recorded its time), the issue was updated after `scored_at`, or the score
 * is older than `maxAgeDays`. Dependency and linked-PR changes are not read here.
 */
export function staleness(entry: { pareto?: Partial<Pareto> & { scored_at?: string } }, issue: Pick<ForgeIssue, 'updatedAt'>, now: Date, maxAgeDays = DEFAULT_MAX_AGE_DAYS): StaleReason | null {
  const scoredAt = Date.parse(entry.pareto?.scored_at ?? '');
  if (Number.isNaN(scoredAt)) return 'unrecorded';
  const updatedAt = Date.parse(issue.updatedAt ?? '');
  if (!Number.isNaN(updatedAt) && updatedAt > scoredAt) return 'edited';
  return now.getTime() - scoredAt > maxAgeDays * DAY_MS ? 'aged' : null;
}

export type RescoreOptions = { now: Date; maxAgeDays?: number };

const toRequest = (i: ForgeIssue, rescore?: Rescore): ScoreRequest => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name), body: (i.body ?? '').slice(0, BODY_EXCERPT), ...(rescore ? { rescore } : {}) });

/**
 * Ready entries due a score, lowest number first: those with no stored priority whose forge body
 * carries no valid `Pareto:` line, and, when `opts` is given, scored ones whose score is stale.
 */
export function scoreRequests(queue: QueueJson | null, issues: ForgeIssue[], opts?: RescoreOptions): ScoreRequest[] {
  const byNumber = new Map(issues.filter((i) => i.state === 'OPEN').map((i) => [String(i.number), i] as const));
  return Object.entries(queue?.issues ?? {})
    .filter(([n, e]) => e.status === 'ready' && byNumber.has(n))
    .flatMap(([n, e]): ScoreRequest[] => {
      const issue = byNumber.get(n)!;
      const current = e.pareto ?? parseParetoLine(issue.body ?? '');
      if (!current) return [toRequest(issue)];
      const reason = opts && staleness({ pareto: e.pareto }, issue, opts.now, opts.maxAgeDays);
      return reason ? [toRequest(issue, { gain: current.gain, effort: current.effort, priority: current.priority, reason })] : [];
    })
    .sort((a, b) => a.number - b.number);
}

/** The returned scores, validated: an array of `{number, gain, effort, rationale}`, gain and effort in 1..10. */
export function parseScores(raw: unknown): Score[] {
  if (!Array.isArray(raw)) throw new TypeError('scores must be a JSON array');
  const seen = new Set<number>();
  return raw.map((row, idx) => {
    const r = row as Partial<Score> | null;
    if (!r || !Number.isInteger(r.number) || typeof r.rationale !== 'string' || !r.rationale.trim()) throw new TypeError(`scores[${idx}] needs an integer number and a non-empty rationale`);
    paretoPriority(r.gain as number, r.effort as number);
    if (seen.has(r.number)) throw new DuplicateScoreError(r.number);
    seen.add(r.number);
    return { number: r.number as number, gain: r.gain as number, effort: r.effort as number, rationale: r.rationale };
  });
}

export { upsertRationaleLine };

/**
 * Moves `scored_at` of every issue this run wrote to past that write: a forge write bumps the
 * issue's `updatedAt`, which `staleness` would otherwise read as a later human edit. The stamp is the
 * later of the run's clock and the `updatedAt` the forge reports after the last write.
 */
async function stampAfterWrites(adapter: ForgeAdapter, queue: QueueJson, written: Set<number>, now: Date): Promise<void> {
  if (!written.size) return;
  const after = new Map((await adapter.issueList({ state: 'open', limit: ISSUE_LIMIT })).map((i) => [i.number, Date.parse(i.updatedAt ?? '')] as const));
  for (const n of written) {
    const entry = queue.issues![String(n)]!;
    if (!entry.pareto?.scored_at) continue;
    const stamp = Math.max(now.getTime(), after.get(n) || 0);
    queue.issues![String(n)] = { ...entry, pareto: { ...entry.pareto, scored_at: new Date(stamp).toISOString() } };
  }
}

/**
 * Writes each score to the forge and the queue, stamped `scored_at`. An issue that already carries a
 * valid line is re-scored only when `opts.rescore` is given and its score is stale (`staleness`);
 * otherwise the forge line wins and only its label is reconciled, which heals a run that
 * stopped between the body edit and the label edit. Forge errors propagate, so a score is never
 * recorded in the queue without its forge write.
 */
export async function applyScores(adapter: ForgeAdapter, queue: QueueJson, issues: ForgeIssue[], scores: Score[], opts: { now?: Date; rescore?: { maxAgeDays?: number } } = {}): Promise<{ queue: QueueJson; outcomes: ApplyOutcome[] }> {
  const now = opts.now ?? new Date();
  const open = new Map(issues.filter((i) => i.state === 'OPEN').map((i) => [i.number, i] as const));
  const next: QueueJson = { ...queue, issues: { ...(queue.issues ?? {}) } };
  const outcomes: ApplyOutcome[] = [];
  const store = (n: number, pareto: Pareto, rationale?: string): void => {
    next.issues![String(n)] = { ...next.issues![String(n)]!, pareto: { ...pareto, scored_at: now.toISOString(), ...(rationale ? { rationale } : {}) } };
  };
  const handled = new Set<number>();
  const written = new Set<number>();
  for (const score of scores) {
    if (handled.has(score.number)) {
      outcomes.push({ number: score.number, result: 'skipped', reason: 'duplicate score entry for this issue' });
      continue;
    }
    handled.add(score.number);
    const entry = next.issues![String(score.number)];
    const issue = open.get(score.number);
    if (!entry || !issue) {
      outcomes.push({ number: score.number, result: 'skipped', reason: !entry ? 'not in the queue' : 'not an open issue on the forge' });
      continue;
    }
    const existing = parseParetoLine(issue.body ?? '');
    const due = existing && opts.rescore && staleness(entry, issue, now, opts.rescore.maxAgeDays);
    if (existing && !due) {
      if (await rescoreIssue(adapter, issue, existing)) written.add(score.number);
      const kept = entry.pareto?.priority === existing.priority ? entry.pareto : undefined;
      next.issues![String(score.number)] = { ...entry, pareto: { ...existing, ...(kept?.scored_at ? { scored_at: kept.scored_at } : {}), ...(kept?.rationale ? { rationale: kept.rationale } : {}) } };
      outcomes.push({ number: score.number, result: 'already-scored' });
      continue;
    }
    if (await rescoreIssue(adapter, { ...issue, body: issue.body ?? '' }, score)) written.add(score.number);
    store(score.number, { gain: score.gain, effort: score.effort, priority: paretoPriority(score.gain, score.effort) }, score.rationale);
    outcomes.push({ number: score.number, result: due ? 'rescored' : 'scored' });
  }
  await stampAfterWrites(adapter, next, written, now);
  return { queue: next, outcomes };
}

/** A forge issue reduced to what the Pareto contract reads. */
export type ForgeIssueView = { number: number; body: string; labels: string[] };
export type ParetoViolation = { number: number; reason: string };

/** Violations of the forge contract (V-PARETO-02): a valid `Pareto:` line plus exactly the one matching `pareto:P*` label. */
export const findParetoLineViolations = (issues: ForgeIssueView[]): ParetoViolation[] =>
  issues.flatMap(({ number, body, labels }) => {
    const scored = parseParetoLine(body);
    if (!scored) return [{ number, reason: 'missing or invalid `Pareto:` body line' }];
    const { add, remove } = reconcileParetoLabels(labels, scored.priority);
    if (add.length) return [{ number, reason: `missing bucket label ${add[0]} for priority ${scored.priority}` }];
    return remove.length ? [{ number, reason: `stray bucket label(s) ${remove.join(', ')} beside ${paretoLabel(scored.priority)}` }] : [];
  });
