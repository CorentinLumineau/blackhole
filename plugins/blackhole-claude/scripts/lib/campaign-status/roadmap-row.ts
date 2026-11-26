import { orderReady } from '../pareto-order.ts';
import type { LaunchRow, QueueJson } from './types.ts';

// The launch summary's Roadmap row: the first issues the run will take, in the order
// `scripts/pareto-order.ts` selects them, and how many scores the bootstrap re-score wrote.
// Display only: it reads `queue.json` and ranks nothing itself.

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

export function roadmapRow(queue: QueueJson | undefined): LaunchRow {
  const issues = queue?.issues ?? {};
  const ready = orderReady(issues);
  const top = ready.slice(0, ROADMAP_TOP).map((n) => `#${n} ${issues[String(n)]?.pareto ? `P${issues[String(n)]!.pareto!.priority}` : 'unscored'}`);
  const rescored = `${rescoredCount(queue)} re-scored this run`;
  const rest = ready.length - top.length;
  return {
    key: 'roadmap',
    label: 'Roadmap',
    header: 'Roadmap',
    value: [...(top.length ? top : ['no ready issue']), rescored, ...(rest > 0 ? [`${rest} more ready`] : [])].join(' · '),
    consequence: 'Workers take ready issues in this order: dependency wave, priority, effort, oldest. Stale scores are redone first.',
    adjustable: false,
  };
}
