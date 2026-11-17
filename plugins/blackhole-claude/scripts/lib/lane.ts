// The lane vocabulary (ADR-053 C4): the label an issue carries while an account works on it, the
// campaign's own lane set, and the claim lease. Pure; the clock is a parameter.

/** The lanes the contributor contract gives the campaign when no lane is configured. */
export const LEGACY_OWN_LANES: ReadonlySet<string> = new Set(['claude', 'blackhole']);

export const LANE_NAME = /^[a-z0-9][a-z0-9._-]*$/;
export const LANE_LABEL_PREFIX = 'in-progress:';
export const DEFAULT_CLAIM_LEASE_HOURS = 24;

const LANE_LABEL = /^(?:in-progress|agent):(.+)$/;

export const laneLabel = (lane: string): string => `${LANE_LABEL_PREFIX}${lane}`;

/** The lane an `in-progress:*` or `agent:*` label names, or null for any other label. */
export const laneOfLabel = (label: string): string | null => LANE_LABEL.exec(label)?.[1] ?? null;

/** The lanes counted as the campaign's own: the configured lane alone, else the legacy pair. */
export const ownLanes = (lane: string | null | undefined): ReadonlySet<string> => (lane ? new Set([lane]) : LEGACY_OWN_LANES);

export type LaneConfig = { lane: string | null; leaseHours: number };

/** Tolerant read for surfaces `run` shares: an invalid or absent `catchup` block reads as no lane. */
export const readLaneConfig = (config: { catchup?: unknown }): LaneConfig => {
  const none: LaneConfig = { lane: null, leaseHours: DEFAULT_CLAIM_LEASE_HOURS };
  const block = config.catchup;
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return none;
  const { lane, claim_lease_hours: lease } = block as { lane?: unknown; claim_lease_hours?: unknown };
  const leaseHours = typeof lease === 'number' && Number.isFinite(lease) && lease > 0 ? lease : DEFAULT_CLAIM_LEASE_HOURS;
  if (lane === undefined || lane === null) return { lane: null, leaseHours };
  if (typeof lane !== 'string' || !LANE_NAME.test(lane)) return none;
  return { lane, leaseHours };
};

const parse = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * A claim is stale when neither the issue nor an open PR closing it moved for `leaseHours`. An
 * absent or unparseable time reads as live: the other claimant keeps the issue.
 */
export const isClaimStale = (a: { updatedAt?: string | null; activityAt?: string | null; now: number; leaseHours: number }): boolean => {
  const times = [parse(a.updatedAt), parse(a.activityAt)].filter((t): t is number => t !== null);
  if (times.length === 0) return false;
  return a.now - Math.max(...times) > a.leaseHours * 3_600_000;
};
