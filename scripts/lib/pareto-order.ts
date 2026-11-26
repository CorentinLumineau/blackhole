import { DONE_STATUSES } from './campaign-status/queue.ts';
import type { QueueIssue } from './campaign-status/types.ts';

// Wave computation and batch order of `queue-dag.md` Steps 4-5, as a pure function over the queue's
// issues: wave asc, stored Pareto priority desc, effort asc, oldest (issue number asc; forge numbers
// grow with creation time). The priority is the one the forge sync stored, never recomputed here.

type Issues = Record<string, QueueIssue>;

const isDone = (i: QueueIssue | undefined): boolean => DONE_STATUSES.includes(i?.status ?? '');

/**
 * Wave 0: no unmet dependency. Wave N: 1 + the highest wave of an unmet dependency. A dependency is
 * met when it is merged or closed; one the queue does not list counts as unmet at wave 0. An issue
 * on a dependency cycle takes wave 0 for the edge that closes the cycle, and is reported in `cycles`.
 */
export function waveOf(issues: Issues): { waves: Record<number, number>; cycles: number[] } {
  const waves: Record<number, number> = {};
  const cycles = new Set<number>();
  const visiting = new Set<number>();
  const visit = (n: number): number => {
    if (waves[n] !== undefined) return waves[n];
    if (visiting.has(n)) {
      cycles.add(n);
      return -1;
    }
    visiting.add(n);
    let wave = 0;
    for (const dep of issues[String(n)]?.depends_on ?? []) {
      if (isDone(issues[String(dep)])) continue;
      wave = Math.max(wave, visit(dep) + 1);
    }
    visiting.delete(n);
    waves[n] = wave;
    return wave;
  };
  for (const key of Object.keys(issues).map(Number).sort((a, b) => a - b)) visit(key);
  return { waves, cycles: [...cycles].sort((a, b) => a - b) };
}

/**
 * The issue numbers `include` accepts, in selection order: wave, owner pin (`userQueueOrder`
 * position, unpinned last), stored priority desc, effort asc, oldest. A pin moves an issue to the
 * front of its own wave only; it never lifts an issue over an unmet dependency.
 */
export function orderIssues(issues: Issues, include: (issue: QueueIssue) => boolean, userQueueOrder: number[] = []): number[] {
  const { waves } = waveOf(issues);
  const rank = (n: number) => {
    const pareto = issues[String(n)].pareto;
    const pin = userQueueOrder.indexOf(n);
    return {
      wave: waves[n],
      pin: pin === -1 ? Number.POSITIVE_INFINITY : pin,
      priority: pareto?.priority ?? -1,
      effort: pareto?.effort ?? Number.POSITIVE_INFINITY,
    };
  };
  return Object.entries(issues)
    .filter(([, i]) => include(i))
    .map(([n]) => Number(n))
    .sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x.wave - y.wave || x.pin - y.pin || y.priority - x.priority || x.effort - y.effort || a - b;
    });
}

/** Ready issue numbers in selection order. */
export const orderReady = (issues: Issues, userQueueOrder: number[] = []): number[] =>
  orderIssues(issues, (i) => i.status === 'ready', userQueueOrder);

/**
 * Up to `limit` issues from the current (lowest) wave's ready set: `userQueueOrder` first, then the
 * Pareto order (`queue-dag.md` Step 5).
 */
export function selectBatch(issues: Issues, limit: number, userQueueOrder: number[] = []): number[] {
  const ordered = orderReady(issues, userQueueOrder);
  if (ordered.length === 0 || limit <= 0) return [];
  const { waves } = waveOf(issues);
  const current = waves[ordered[0]];
  return ordered.filter((n) => waves[n] === current).slice(0, limit);
}

/** The ready issues of `batch` that carry no stored score: `pareto-order.ts --require-scored` fails on them. */
export const unscoredIn = (issues: Issues, batch: number[]): number[] => batch.filter((n) => !issues[String(n)]?.pareto);
