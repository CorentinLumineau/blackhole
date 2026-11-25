import type { QueueJson } from './campaign-status/types.ts';
import { rescoreIssue } from './forge-adapter/pareto-filing.ts';
import type { ForgeAdapter, ForgeIssue } from './forge-adapter/types.ts';
import { paretoPriority, parseParetoLine, type Pareto } from './pareto.ts';

// Mechanical side of score-on-ingest (`forge-sync.md` § Score on ingest): finds the ready queue
// entries whose issue has no valid `Pareto:` line, and applies the scores the orchestrator's LLM
// judgement returns. The judgement itself is not here. No process or filesystem access.

export type ScoreRequest = { number: number; title: string; labels: string[]; body: string };
export type Score = { number: number; gain: number; effort: number; rationale: string };
export type ApplyOutcome = { number: number; result: 'scored' | 'already-scored' | 'skipped'; reason?: string };

const BODY_EXCERPT = 4000;
const RATIONALE_MAX = 200;
const RATIONALE_LINE = /^[ \t]*Pareto rationale:[^\r\n]*$/im;

/** Ready entries with no stored priority whose forge body carries no valid `Pareto:` line, lowest number first. */
export function scoreRequests(queue: QueueJson | null, issues: ForgeIssue[]): ScoreRequest[] {
  const byNumber = new Map(issues.filter((i) => i.state === 'OPEN').map((i) => [String(i.number), i] as const));
  return Object.entries(queue?.issues ?? {})
    .filter(([n, e]) => e.status === 'ready' && !e.pareto && byNumber.has(n) && !parseParetoLine(byNumber.get(n)!.body ?? ''))
    .map(([n]) => byNumber.get(n)!)
    .sort((a, b) => a.number - b.number)
    .map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name), body: (i.body ?? '').slice(0, BODY_EXCERPT) }));
}

/** The returned scores, validated: an array of `{number, gain, effort, rationale}`, gain and effort in 1..10. */
export function parseScores(raw: unknown): Score[] {
  if (!Array.isArray(raw)) throw new TypeError('scores must be a JSON array');
  return raw.map((row, idx) => {
    const r = row as Partial<Score> | null;
    if (!r || !Number.isInteger(r.number) || typeof r.rationale !== 'string' || !r.rationale.trim()) throw new TypeError(`scores[${idx}] needs an integer number and a non-empty rationale`);
    paretoPriority(r.gain as number, r.effort as number);
    return { number: r.number as number, gain: r.gain as number, effort: r.effort as number, rationale: r.rationale };
  });
}

/** Writes the one `Pareto rationale:` line: replaces an existing one in place, else appends. Single line, capped. */
export function upsertRationaleLine(body: string, rationale: string): string {
  const flat = rationale.replace(/\s+/g, ' ').trim();
  const line = `Pareto rationale: ${flat.length > RATIONALE_MAX ? `${flat.slice(0, RATIONALE_MAX - 1)}…` : flat}`;
  return RATIONALE_LINE.test(body) ? body.replace(RATIONALE_LINE, line) : `${body}\n\n${line}`;
}

/**
 * Writes each score to the forge and the queue. An issue that already carries a valid line is never
 * re-scored here (re-scoring is its own step): only its label is reconciled, which heals a run that
 * stopped between the body edit and the label edit. Forge errors propagate, so a score is never
 * recorded in the queue without its forge write.
 */
export async function applyScores(adapter: ForgeAdapter, queue: QueueJson, issues: ForgeIssue[], scores: Score[]): Promise<{ queue: QueueJson; outcomes: ApplyOutcome[] }> {
  const open = new Map(issues.filter((i) => i.state === 'OPEN').map((i) => [i.number, i] as const));
  const next: QueueJson = { ...queue, issues: { ...(queue.issues ?? {}) } };
  const outcomes: ApplyOutcome[] = [];
  const store = (n: number, pareto: Pareto): void => {
    next.issues![String(n)] = { ...next.issues![String(n)]!, pareto };
  };
  for (const score of scores) {
    const entry = next.issues![String(score.number)];
    const issue = open.get(score.number);
    if (!entry || !issue) {
      outcomes.push({ number: score.number, result: 'skipped', reason: !entry ? 'not in the queue' : 'not an open issue on the forge' });
      continue;
    }
    const existing = parseParetoLine(issue.body ?? '');
    if (existing) {
      await rescoreIssue(adapter, issue, existing);
      store(score.number, existing);
      outcomes.push({ number: score.number, result: 'already-scored' });
      continue;
    }
    await rescoreIssue(adapter, { ...issue, body: upsertRationaleLine(issue.body ?? '', score.rationale) }, score);
    store(score.number, { gain: score.gain, effort: score.effort, priority: paretoPriority(score.gain, score.effort) });
    outcomes.push({ number: score.number, result: 'scored' });
  }
  return { queue: next, outcomes };
}
