import { createHash } from 'crypto';

/** Minimum number of PRs failing identically, none of them owning the failing path. */
export const TRUNK_RED_MIN_PRS = 2;

export type TrunkRedFailure = {
  check: string;
  fingerprint: string;
  /** Repo-relative paths the failure names; a PR whose diff touches one owns the failure. */
  failingPaths?: string[];
};

export type TrunkRedPr = {
  pr: number;
  failingChecks: TrunkRedFailure[];
  touchedFiles: string[];
};

export type TrunkRedGroup = { check: string; fingerprint: string; prs: number[] };

export type TrunkRedResult = {
  classification: 'trunk-red' | 'per-pr';
  groups: TrunkRedGroup[];
};

const RUNNER_PREFIX = /^(?:\/(?:home|Users)\/runner\/work\/[^/]+\/[^/]+\/|\/github\/workspace\/)/;

/** Repo-relative form of a path: no leading `./`, no GitHub runner checkout prefix. */
export function normalizeRepoPath(p: string): string {
  return p.replace(RUNNER_PREFIX, '').replace(/^(?:\.\/)+/, '');
}

/** A failing check that no PR's own diff explains, seen on at least two PRs, is a red trunk. */
export function classifyTrunkRed(prs: TrunkRedPr[]): TrunkRedResult {
  const byKey = new Map<string, TrunkRedGroup>();
  for (const { pr, failingChecks, touchedFiles } of prs) {
    const touched = new Set(touchedFiles.map(normalizeRepoPath));
    for (const { check, fingerprint, failingPaths = [] } of failingChecks) {
      if (fingerprint.trim() === '') continue;
      if (failingPaths.some((p) => touched.has(normalizeRepoPath(p)))) continue;
      const key = `${check}\u0000${fingerprint}`;
      const group = byKey.get(key) ?? { check, fingerprint, prs: [] };
      if (!group.prs.includes(pr)) group.prs.push(pr);
      byKey.set(key, group);
    }
  }
  const groups = [...byKey.values()].filter((g) => g.prs.length >= TRUNK_RED_MIN_PRS);
  return { classification: groups.length > 0 ? 'trunk-red' : 'per-pr', groups };
}

const VOLATILE = /\d{4}-\d{2}-\d{2}T[\d:.]+Z?|\b[0-9a-f]{7,40}\b|\d+/gi;
const ERROR_LINE = /error|fail|✗|✕|expected|not assignable|cannot|unexpected/i;
const GENERIC_LINE = /exited with code|Process completed with exit code/i;
const WINDOW_RADIUS = 3;

/** Index of the line that identifies the failure, skipping blank and generic wrapper lines; -1 if none. */
function failureLineIndex(lines: string[]): number {
  const usable = (l: string) => l.trim() !== '' && !GENERIC_LINE.test(l);
  const hit = lines.findIndex((l) => usable(l) && ERROR_LINE.test(l));
  return hit >= 0 ? hit : lines.findIndex(usable);
}

/** Stable id for one failure: the failure line with digits, hashes and timestamps removed; '' when the log has none. */
export function fingerprintLog(log: string): string {
  const lines = log.split('\n');
  const idx = failureLineIndex(lines);
  if (idx < 0) return '';
  const normalized = lines[idx].trim().replace(VOLATILE, '#').replace(/\s+/g, ' ');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

const PATH_RE = /(?:^|[\s("'=])((?:\.\/|\/)?(?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z][A-Za-z0-9]*)(?=[:(\s"')\],.;]|$)/g;

/** Normalised repo-relative file paths named in a log, first-seen order, deduplicated. */
export function pathsInLog(log: string): string[] {
  const out: string[] = [];
  for (const m of log.matchAll(PATH_RE)) {
    const p = normalizeRepoPath(m[1]);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Paths named within a few lines of the fingerprint line, not the whole log. */
export function failingPaths(log: string): string[] {
  const lines = log.split('\n');
  const idx = failureLineIndex(lines);
  if (idx < 0) return [];
  return pathsInLog(lines.slice(Math.max(0, idx - WINDOW_RADIUS), idx + WINDOW_RADIUS + 1).join('\n'));
}
