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

/** A failing check that no PR's own diff explains, seen on at least two PRs, is a red trunk. */
export function classifyTrunkRed(prs: TrunkRedPr[]): TrunkRedResult {
  const byKey = new Map<string, TrunkRedGroup>();
  for (const { pr, failingChecks, touchedFiles } of prs) {
    const touched = new Set(touchedFiles);
    for (const { check, fingerprint, failingPaths = [] } of failingChecks) {
      if (failingPaths.some((p) => touched.has(p))) continue;
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

/** Stable id for one failure: the first error-looking line with digits, hashes and timestamps removed. */
export function fingerprintLog(log: string): string {
  const lines = log.split('\n').map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => ERROR_LINE.test(l)) ?? lines[0] ?? '';
  const normalized = line.replace(VOLATILE, '#').replace(/\s+/g, ' ');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

const PATH_RE = /(?:^|[\s("'])((?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]+)(?=[:(\s"')]|$)/g;

/** Repo-relative file paths named in a log, first-seen order, deduplicated. */
export function pathsInLog(log: string): string[] {
  const out: string[] = [];
  for (const m of log.matchAll(PATH_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
