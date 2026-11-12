import * as fs from 'fs';
import * as path from 'path';
import type { ConfigSummaryInput, StatusAlert } from './types.ts';

/** Hours without a state write after which the campaign is reported stale. The one threshold every
 * staleness check reads: the status page banner and the `bun run status` alert line. */
export const STALE_AFTER_HOURS = 2;

const HOUR_MS = 3_600_000;

/** The newest valid ISO timestamp among the campaign's state writes, or null when none parses. */
export function newestStateWrite(...timestamps: Array<string | null | undefined>): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const iso of timestamps) {
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isNaN(ms) && (best === null || ms > best.ms)) best = { iso: iso as string, ms };
  }
  return best?.iso ?? null;
}

/** Hours between the last state write and `nowIso`, to one decimal; null when either is missing. */
export function stateAgeHours(lastIso: string | null, nowIso: string): number | null {
  const last = lastIso ? Date.parse(lastIso) : NaN;
  const now = Date.parse(nowIso);
  if (Number.isNaN(last) || Number.isNaN(now)) return null;
  return Math.round(Math.max(0, now - last) / HOUR_MS * 10) / 10;
}

/** An unknown age is stale: a state file that never recorded a write must not look live. */
export const isStateStale = (ageHours: number | null): boolean => ageHours === null || ageHours > STALE_AFTER_HOURS;

type AlertInput = {
  checkpointRefreshedAt: string | null | undefined;
  queueRefreshedAt: string | null | undefined;
  nowIso: string;
  statusPageEnabled: boolean;
  artifactPublished: boolean;
};

/** Loud lines for a campaign whose state stopped being written or whose status page was never published.
 * Same freshness inputs as the status page banner, so the two can never disagree. */
export function computeStatusAlerts(i: AlertInput): StatusAlert[] {
  const alerts: StatusAlert[] = [];
  const ageHours = stateAgeHours(newestStateWrite(i.checkpointRefreshedAt, i.queueRefreshedAt), i.nowIso);
  if (isStateStale(ageHours)) {
    alerts.push({
      kind: 'stale_state',
      message:
        ageHours === null
          ? `⚠ Campaign state has no write time, so it may be frozen (threshold ${STALE_AFTER_HOURS}h): the checkpoint may have stopped.`
          : `⚠ Campaign state last written ${ageHours}h ago (threshold ${STALE_AFTER_HOURS}h): the checkpoint may have stopped.`,
    });
  }
  if (i.statusPageEnabled && !i.artifactPublished) {
    alerts.push({
      kind: 'page_never_published',
      message:
        '⚠ Status page never published: .blackhole/status-artifact.json is absent. Run `bun run status --html` and publish it (status-page.md).',
    });
  }
  return alerts;
}

/** `status_page.enabled` defaults to true when the block or key is absent (`config-template.md`). */
export const statusPageEnabled = (config: ConfigSummaryInput): boolean => config.status_page?.enabled !== false;

/** The alerts for a campaign directory: reads whether the published-page marker exists. */
export function readStatusAlerts(
  campaignDir: string,
  state: { config: ConfigSummaryInput; checkpoint: { refreshed_at?: string }; queue: { refreshed_at?: string } },
  nowIso: string,
): StatusAlert[] {
  return computeStatusAlerts({
    checkpointRefreshedAt: state.checkpoint.refreshed_at,
    queueRefreshedAt: state.queue.refreshed_at,
    nowIso,
    statusPageEnabled: statusPageEnabled(state.config),
    artifactPublished: fs.existsSync(path.join(campaignDir, 'status-artifact.json')),
  });
}
