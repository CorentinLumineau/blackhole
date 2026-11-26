// The one Pareto scale (V-PARETO-02/03): Priority = Gain * (11 - Effort), both 1..10. The forge
// issue body carries it as `Pareto: gain=G effort=E priority=N`; forge-sync parses that line into
// the queue entry's `pareto`, and batch selection reads the stored priority. Pure: no I/O.

export type Pareto = { gain: number; effort: number; priority: number };
export type ParetoBucket = 'P1' | 'P2' | 'P3' | 'P4';

/** Lower bound (inclusive) of each bucket, highest first. */
export const PARETO_BUCKETS: ReadonlyArray<{ bucket: ParetoBucket; min: number }> = [
  { bucket: 'P1', min: 70 },
  { bucket: 'P2', min: 50 },
  { bucket: 'P3', min: 30 },
  { bucket: 'P4', min: 0 },
];

const inScale = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 10;

export function paretoPriority(gain: number, effort: number): number {
  if (!inScale(gain) || !inScale(effort)) throw new RangeError(`Pareto gain and effort are integers in 1..10, got gain=${gain} effort=${effort}`);
  return gain * (11 - effort);
}

export const paretoBucket = (priority: number): ParetoBucket => PARETO_BUCKETS.find((b) => priority >= b.min)?.bucket ?? 'P4';

export const paretoLabel = (priority: number): string => `pareto:${paretoBucket(priority)}`;

export const formatParetoLine = ({ gain, effort }: { gain: number; effort: number }): string => `Pareto: gain=${gain} effort=${effort} priority=${paretoPriority(gain, effort)}`;

const LINE = /^[ \t]*Pareto:[ \t]*gain=(\d+)[ \t]+effort=(\d+)[ \t]+priority=(\d+)[ \t]*$/gim;

/**
 * The first valid `Pareto:` line of an issue body. A line whose numbers fall outside the scale, or
 * whose priority disagrees with the formula, is skipped (a stale or hand-edited line reads as
 * unscored). Lines inside a fenced code block are not special-cased.
 */
export function parseParetoLine(body: string): Pareto | null {
  for (const m of body.matchAll(LINE)) {
    const [gain, effort, priority] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (inScale(gain) && inScale(effort) && priority === gain * (11 - effort)) return { gain, effort, priority };
  }
  return null;
}

/**
 * Writes the one `Pareto:` line into an issue body: replaces the first existing line (valid or
 * stale) in place, drops any further `Pareto:` lines, appends when none exists. Idempotent, and
 * leaves the surrounding line endings untouched.
 */
const RATIONALE_MAX = 200;
const RATIONALE_LINE = /^[ \t]*Pareto rationale:[^\r\n]*$/im;

/** Writes the one `Pareto rationale:` line: replaces an existing one in place, else appends. Single line, capped. */
export function upsertRationaleLine(body: string, rationale: string): string {
  const flat = rationale.replace(/\s+/g, ' ').trim();
  const line = `Pareto rationale: ${flat.length > RATIONALE_MAX ? `${flat.slice(0, RATIONALE_MAX - 1)}…` : flat}`;
  return RATIONALE_LINE.test(body) ? body.replace(RATIONALE_LINE, line) : `${body}\n\n${line}`;
}

export function upsertParetoLine(body: string, scoring: { gain: number; effort: number }): string {
  const line = formatParetoLine(scoring);
  const anyLine = /^[ \t]*Pareto:[^\r\n]*$/gim;
  let seen = false;
  const next = body.replace(new RegExp(`(?:\\r?\\n)?${anyLine.source}`, 'gim'), (match) => {
    if (seen) return '';
    seen = true;
    return match.replace(/[^\r\n]*$/, line);
  });
  return seen ? next : `${body}\n\n${line}`;
}

/** The label edit that leaves exactly one `pareto:*` label on an issue: the bucket of `priority`. */
export function reconcileParetoLabels(currentLabels: string[], priority: number): { add: string[]; remove: string[] } {
  const want = paretoLabel(priority);
  return {
    add: currentLabels.includes(want) ? [] : [want],
    remove: currentLabels.filter((l) => l.startsWith('pareto:') && l !== want),
  };
}
