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

const RUNNER_PREFIX =
  /^(?:\/(?:home|Users)\/runner\/work\/[^/]+\/[^/]+\/|\/(?:[^/]+\/)*?_work\/[^/]+\/[^/]+\/|\/github\/workspace\/)/;

/** Repo-relative form of a path: no leading `./`, no hosted or self-hosted runner checkout prefix. */
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
const RUN_LINE = /^(?:##\[group\])?Run\s/;
const END_GROUP = /^##\[endgroup\]/;
/** Ungrouped echoed step settings: `shell:`, `env:`/`with:` headers and their indented `KEY: value` entries — never an indented failure line. */
const ECHOED_SETTING = /^(?:shell:|env:|with:|\s+[\w-]+:(?:\s|$))/;
const LOG_LINE_PREFIX = /^\uFEFF?(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?)?/;

/** A GitHub Actions log line without its leading BOM and ISO-8601 timestamp. */
export function stripLogPrefix(line: string): string {
  return line.replace(LOG_LINE_PREFIX, '');
}

const logLines = (log: string): string[] => log.split(/\r?\n/).map(stripLogPrefix);

/** Where a step's echoed `Run` preamble (command, script, shell, env) starts and ends; header -1 when there is none. */
function preamble(lines: string[]): { header: number; end: number } {
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0 || !RUN_LINE.test(lines[first])) return { header: -1, end: 0 };
  const endGroup = lines.findIndex((l, i) => i > first && END_GROUP.test(l));
  if (endGroup >= 0) return { header: first, end: endGroup + 1 };
  let i = first + 1;
  while (i < lines.length && ECHOED_SETTING.test(lines[i])) i++;
  return { header: first, end: i };
}

/** First line from `start` that identifies the failure, skipping blank and generic wrapper lines; -1 if none. */
function failureLineFrom(lines: string[], start: number): number {
  const usable = (l: string, i: number) => i >= start && l.trim() !== '' && !GENERIC_LINE.test(l);
  const hit = lines.findIndex((l, i) => usable(l, i) && ERROR_LINE.test(l));
  return hit >= 0 ? hit : lines.findIndex(usable);
}

/**
 * The failure line past the preamble, and the window start that excludes it. When the step's output was
 * logged inside its own group (nothing follows `##[endgroup]`), only the `Run` header itself is skipped.
 */
function locateFailure(lines: string[]): { idx: number; from: number } {
  const { header, end } = preamble(lines);
  const idx = failureLineFrom(lines, end);
  if (idx >= 0 || header < 0) return { idx, from: end };
  return { idx: failureLineFrom(lines, header + 1), from: header + 1 };
}

/** Stable id for one failure: the failure line with digits, hashes and timestamps removed; '' when the log has none. */
export function fingerprintLog(log: string): string {
  const lines = logLines(log);
  const { idx } = locateFailure(lines);
  if (idx < 0) return '';
  const normalized = lines[idx].trim().replace(VOLATILE, '#').replace(/\s+/g, ' ');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

const PATH_RE = /(?:^|[\s("'=[\]])((?:\.\/|\/)?(?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z][A-Za-z0-9]*)(?=[:(\s"')\],.;]|$)/g;

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
  const lines = logLines(log);
  const { idx, from: floor } = locateFailure(lines);
  if (idx < 0) return [];
  const from = Math.max(floor, idx - WINDOW_RADIUS);
  return pathsInLog(lines.slice(from, idx + WINDOW_RADIUS + 1).join('\n'));
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Validates classifier input read from JSON; throws naming the first bad entry and field. */
export function parseTrunkRedPrs(input: unknown): TrunkRedPr[] {
  if (!Array.isArray(input)) throw new Error('expected a JSON array of { pr, failingChecks, touchedFiles }');
  input.forEach((entry, i) => {
    const bad = (field: string) => new Error(`entry ${i}: ${field} is missing or malformed`);
    if (typeof entry !== 'object' || entry === null) throw bad('entry');
    if (typeof entry.pr !== 'number') throw bad('pr');
    if (!isStringArray(entry.touchedFiles)) throw bad('touchedFiles');
    if (!Array.isArray(entry.failingChecks)) throw bad('failingChecks');
    for (const f of entry.failingChecks) {
      if (typeof f?.check !== 'string' || typeof f?.fingerprint !== 'string') throw bad('failingChecks[].check/fingerprint');
      if (f.failingPaths !== undefined && !isStringArray(f.failingPaths)) throw bad('failingChecks[].failingPaths');
    }
  });
  return input as TrunkRedPr[];
}
