import { orderReady, selectBatch } from '../pareto-order.ts';
import type { LaunchRow, QueueJson } from './types.ts';

// The launch summary's Roadmap row: the first issues the run will take, in the order
// `scripts/pareto-order.ts` selects them (owner pins first, as `selectBatch` takes them), and how
// many scores the bootstrap re-score wrote. Display only: it reads `queue.json` and ranks nothing itself.

/** How many issues the row names. */
export const ROADMAP_TOP = 5;

/**
 * Scores written since the bootstrap sync: the sync stamps `refreshed_at` before the re-score runs,
 * and `pareto-score.ts apply` stamps each score it writes `scored_at`. A queue with no sync time
 * counts none rather than every score ever made.
 */
export function rescoredCount(queue: QueueJson | undefined): number {
  const since = Date.parse(queue?.refreshed_at ?? '');
  if (Number.isNaN(since)) return 0;
  return Object.values(queue?.issues ?? {}).filter((i) => Date.parse(i.pareto?.scored_at ?? '') >= since).length;
}

/** The ready issues in the order the run takes them: the current wave pin-first, then the later waves. */
function readyInRunOrder(queue: QueueJson | undefined): number[] {
  const issues = queue?.issues ?? {};
  const first = selectBatch(issues, Number.POSITIVE_INFINITY, queue?.user_queue_order ?? []);
  const taken = new Set(first);
  return [...first, ...orderReady(issues).filter((n) => !taken.has(n))];
}

export function roadmapRow(queue: QueueJson | undefined): LaunchRow {
  const issues = queue?.issues ?? {};
  const ready = readyInRunOrder(queue);
  const top = ready.slice(0, ROADMAP_TOP).map((n) => `#${n} ${issues[String(n)]?.pareto ? `P${issues[String(n)]!.pareto!.priority}` : 'unscored'}`);
  const rescored = `${rescoredCount(queue)} re-scored this run`;
  const rest = ready.length - top.length;
  return {
    key: 'roadmap',
    label: 'Roadmap',
    header: 'Roadmap',
    value: [...(top.length ? top : ['no ready issue']), rescored, ...(rest > 0 ? [`${rest} more ready`] : [])].join(' · '),
    consequence: 'Workers take ready issues in this order: dependency wave, owner pins, priority, effort, oldest. Stale scores are redone first.',
    adjustable: false,
  };
}
