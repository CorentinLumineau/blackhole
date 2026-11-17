import { placeDependencyLines } from '../../forge-deps.ts';
import type { DependencyRef, DependencyTarget, ForgeDependencies, ForgeType } from './types.ts';

// The one get/set flow behind every backend's `getDependencies`/`setDependencies` (ADR-027): a
// backend supplies its native "blocked by" channel and its PR-body channel, and this module decides
// which edge goes where, writes only the difference, and reads the result back. An edge the native
// channel cannot hold (no native feature on the repo, a cross-repo or non-issue blocker on
// GitHub/Gitea, an issue blocker on GitLab) becomes a `Blocked by #N` line in the PR body, the
// fallback a human sees on any forge. An edge the planner passes back with its read tag (`via`)
// stays in that channel; one passed without it is placed afresh, native first, so a same-repo body
// line the planner resolved to a queue issue is promoted to a native issue edge.

/** One native edge as the forge lists it; `handle` is whatever the backend needs to delete it. */
export type NativeEdge = { ref: DependencyRef; handle: string | number };

export interface NativeDependencyChannel {
  /**
   * The target's native edges, or null when the forge answered that the feature does not exist
   * here (404/410). Any other failure, a 403 included (rate limit, token scope), throws.
   */
  list(target: DependencyTarget): NativeEdge[] | null;
  /** Whether a native edge of `target` can name `ref`. */
  holds(ref: DependencyRef, target: DependencyTarget): boolean;
  add(target: DependencyTarget, ref: DependencyRef): void;
  remove(target: DependencyTarget, edge: NativeEdge): void;
}

export interface BodyChannel {
  read(pr: number): string;
  write(pr: number, body: string): void;
}

/** GitLab numbers issues (`#N`) and merge requests (`!N`) apart; GitHub and Gitea share one sequence. */
const sigil = (ref: DependencyRef, forge: ForgeType): '#' | '!' => (forge === 'gitlab' && ref.kind === 'pr' ? '!' : '#');

/** The identity of an edge: two refs with one key are the same blocker. */
export const refKey = (ref: DependencyRef, forge: ForgeType): string => `${ref.repo}${sigil(ref, forge)}${ref.number}`;

export const dedupeRefs = (refs: DependencyRef[], forge: ForgeType): DependencyRef[] => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = refKey(ref, forge);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const sameKeys = (a: DependencyRef[], b: DependencyRef[], forge: ForgeType): boolean => {
  const ka = new Set(a.map((r) => refKey(r, forge)));
  const kb = new Set(b.map((r) => refKey(r, forge)));
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
};

// Same keywords as the issue-body parser (`scripts/forge-deps.ts`). GitHub and Gitea name another
// repo as exactly `owner/name`; a GitLab project path may nest groups.
const OWNER_NAME_LINE = /^(?:blocked by|depends on|after)\s+(?:([A-Za-z0-9][\w.-]*\/[\w.-]+))?(#)(\d+)(?:\s+merges)?\s*$/i;
const LINE_RE: Record<ForgeType, RegExp> = {
  github: OWNER_NAME_LINE,
  gitea: OWNER_NAME_LINE,
  gitlab: /^(?:blocked by|depends on|after)\s+(?:([A-Za-z0-9][\w.-]*(?:\/[\w.-]+)+))?([#!])(\d+)(?:\s+merges)?\s*$/i,
};

/** The dependency lines of a PR body, in order, each once. A line without a repo names `repo`. */
export const parseBodyRefs = (body: string, repo: string, forge: ForgeType): DependencyRef[] => {
  const refs: DependencyRef[] = [];
  for (const line of body.split('\n')) {
    const m = line.trim().match(LINE_RE[forge]);
    if (m) refs.push({ repo: m[1] ?? repo, number: Number(m[3]), kind: m[2] === '!' ? 'pr' : 'issue' });
  }
  return dedupeRefs(refs, forge);
};

/** `body` with exactly one canonical `Blocked by` line per ref and no other dependency line. */
export const writeBodyRefs = (body: string, refs: DependencyRef[], repo: string, forge: ForgeType): string => {
  const kept = (body.trim() ? body.split('\n') : []).filter((line) => !LINE_RE[forge].test(line.trim()));
  const lines = dedupeRefs(refs, forge).map(
    (ref) => `Blocked by ${ref.repo === repo ? '' : ref.repo}${sigil(ref, forge)}${ref.number}`,
  );
  return placeDependencyLines(kept, lines);
};

export const readDependencies = (
  forge: ForgeType,
  repo: string,
  target: DependencyTarget,
  native: NativeDependencyChannel,
  bodies: BodyChannel,
): ForgeDependencies => {
  const edges = native.list(target);
  const fromNative = (edges ?? []).map((e): DependencyRef => ({ ...e.ref, via: 'native' }));
  const fromBody = parseBodyRefs(bodies.read(target.pr), repo, forge).map((r): DependencyRef => ({ ...r, via: 'body' }));
  return { native: edges !== null, blockedBy: dedupeRefs([...fromNative, ...fromBody], forge) };
};

export const writeDependencies = (
  forge: ForgeType,
  repo: string,
  target: DependencyTarget,
  blockedBy: DependencyRef[],
  native: NativeDependencyChannel,
  bodies: BodyChannel,
): ForgeDependencies => {
  const want = dedupeRefs(blockedBy, forge);
  const edges = native.list(target);
  const wantNative = edges ? want.filter((ref) => ref.via === 'native' || (ref.via !== 'body' && native.holds(ref, target))) : [];
  const nativeKeys = new Set(wantNative.map((r) => refKey(r, forge)));
  const wantBody = want.filter((ref) => !nativeKeys.has(refKey(ref, forge)));
  if (edges) {
    const have = new Set(edges.map((e) => refKey(e.ref, forge)));
    for (const edge of edges) if (!nativeKeys.has(refKey(edge.ref, forge))) native.remove(target, edge);
    for (const ref of wantNative) if (!have.has(refKey(ref, forge))) native.add(target, ref);
  }
  const body = bodies.read(target.pr);
  if (!sameKeys(parseBodyRefs(body, repo, forge), wantBody, forge)) bodies.write(target.pr, writeBodyRefs(body, wantBody, repo, forge));
  return readDependencies(forge, repo, target, native, bodies);
};

/**
 * True when a failed forge call says the endpoint or feature does not exist here: an `HTTP 404` or
 * `HTTP 410` status, never a bare number (an issue #404 or a repo `app-404` in the message is not a
 * status). A 403 is not that either: a rate limit or a token without the scope fails loudly.
 */
export const isUnavailable = (text: string): boolean => /\bHTTP\s*(?:404|410)\b/.test(text);
