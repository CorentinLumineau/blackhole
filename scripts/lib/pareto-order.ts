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

/** Ready issue numbers in selection order. */
export function orderReady(issues: Issues): number[] {
  const { waves } = waveOf(issues);
  const rank = (n: number) => {
    const pareto = issues[String(n)].pareto;
    return { wave: waves[n], priority: pareto?.priority ?? -1, effort: pareto?.effort ?? Number.POSITIVE_INFINITY };
  };
  return Object.entries(issues)
    .filter(([, i]) => i.status === 'ready')
    .map(([n]) => Number(n))
    .sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x.wave - y.wave || y.priority - x.priority || x.effort - y.effort || a - b;
    });
}

/**
 * Up to `limit` issues from the current (lowest) wave's ready set: `userQueueOrder` first, then the
 * Pareto order (`queue-dag.md` Step 5).
 */
export function selectBatch(issues: Issues, limit: number, userQueueOrder: number[] = []): number[] {
  const ordered = orderReady(issues);
  if (ordered.length === 0 || limit <= 0) return [];
  const { waves } = waveOf(issues);
  const current = waves[ordered[0]];
  const pinned = (n: number) => {
    const at = userQueueOrder.indexOf(n);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  return ordered
    .filter((n) => waves[n] === current)
    .sort((a, b) => pinned(a) - pinned(b)) // stable: ties keep the Pareto order
    .slice(0, limit);
}
