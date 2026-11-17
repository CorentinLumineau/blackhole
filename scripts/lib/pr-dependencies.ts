import { parseCrossRepoDepsFromBody, type CrossRepoDep } from '../forge-deps.ts';
import { dedupeRefs, refKey } from './forge-adapter/dependencies.ts';
import type { DependencyRef, ForgeAdapter, ForgeType } from './forge-adapter/types.ts';
import { isOpenPr } from './stack-parent.ts';

// Mirrors each open PR's queue dependencies onto the forge and reads the forge's back
// (forge-sync.md § 6.8). Owner rule: a stack is the main way to express a PR dependency. When B
// depends on exactly one open PR A of the same repo, the forge edge is B's base branch = A's head
// branch. A native "blocked by" edge is used only where a stack cannot say it: two or more open
// PRs, an issue with no PR yet, or a PR in another repo. Read-back follows the same split: a live
// stacked base and a forge "blocked by" edge both become `depends_on` edges.
//
// Two-way and idempotent through a three-way merge against the forge view recorded at the last
// sync (`forge_deps.synced`): an edge on one side only is kept when it is new since that sync and
// dropped when it was there before (the other side removed it). Cross-repo edges stay body-owned
// (§ 6.7): the issue body's lines are pushed, an edge a human adds on the forge is kept, and one
// the body dropped since the last sync is removed.

/** What the last sync saw on the forge (`synced`) and which cross-repo edges it pushed from the issue body (`body_cross`). */
export type ForgeDepsState = { synced: string[]; body_cross: string[] };

export type PrDepsIssue = {
  status?: string;
  pr?: number | null;
  depends_on?: number[];
  forge_deps?: ForgeDepsState;
};

/** One PR's forge state: its declared blockers and the branch it targets. */
export type PrForgeRead = { blockedBy: DependencyRef[]; baseRefName?: string };

export type OpenPrHead = { number: number; headRefName: string; headRepoIsFork?: boolean };

export type PlanInput = {
  repo: string;
  forge: ForgeType;
  issues: Record<string, PrDepsIssue>;
  /** Every open PR of the repo, queue issue or not: a base branch is matched against their heads. */
  openPrs: OpenPrHead[];
  /** Keyed by queue issue number; an issue whose forge state was not read is not planned. */
  reads: Record<string, PrForgeRead>;
  /** The cross-repo dependency lines of each issue's body (`parseCrossRepoDepsFromBody`). */
  crossRepoBody: Record<string, CrossRepoDep[]>;
};

export type Restack = { parent: number; parentPr: number; parentBranch: string };

export type PrDepsPlan = {
  issue: number;
  pr: number;
  /** The issue's new `depends_on`. */
  dependsOn: number[];
  /** The issue's new `forge_deps`, as the forge reads once `blockedBy` is written. */
  forgeDeps: ForgeDepsState;
  /** The PR's blocker set to write with `setDependencies`. */
  blockedBy: DependencyRef[];
  /** False when the forge already declares exactly `blockedBy`. */
  write: boolean;
  /** Retarget the PR onto this parent's branch (`stack-repair.ts restack`); null when the stack is right or cannot express the dependency. */
  restack: Restack | null;
  /** The queue issue whose branch the PR is based on now, if any. */
  stackedOn: number | null;
  /** Forge blockers that name no queue issue and cannot be read as one; kept on the forge, never a DAG edge. */
  unresolved: DependencyRef[];
};

const SATISFIED = new Set(['merged', 'closed']);
const issueKey = (n: number) => `#${n}`;
const keyIssue = (k: string) => Number(k.slice(1));
const isIssueKey = (k: string) => /^#\d+$/.test(k);

/** Kept on one side only: new since the last sync stays, there before goes. No last sync: the union. */
const merge3 = (queue: Set<string>, forge: Set<string>, last: Set<string> | null): Set<string> => {
  if (!last) return new Set([...queue, ...forge]);
  return new Set([...queue, ...forge, ...last].filter((k) => (last.has(k) ? queue.has(k) && forge.has(k) : queue.has(k) || forge.has(k))));
};

export function planPrDependencies(input: PlanInput): PrDepsPlan[] {
  const { repo, forge, issues } = input;
  const sharedNumbers = forge !== 'gitlab';
  const byPr = new Map(Object.entries(issues).filter(([, v]) => v.pr != null).map(([k, v]) => [v.pr as number, Number(k)]));
  const satisfied = (n: number) => SATISFIED.has(issues[String(n)]?.status ?? '');

  /** The queue issue a same-repo forge ref names; null when it names none that can be read. */
  const resolve = (r: DependencyRef): number | null => {
    if (r.kind === 'pr' || sharedNumbers) {
      const hit = byPr.get(r.number);
      if (hit != null) return hit;
    }
    return r.kind === 'issue' || sharedNumbers ? r.number : null;
  };
  const toRef = (n: number): DependencyRef => {
    const dep = issues[String(n)];
    return isOpenPr(dep) ? { repo, number: dep!.pr as number, kind: 'pr' } : { repo, number: n, kind: 'issue' };
  };
  const crossKey = (d: CrossRepoDep) => refKey({ repo: d.repo, number: d.number, kind: 'pr' }, forge);

  const plans: PrDepsPlan[] = [];
  for (const [key, me] of Object.entries(issues).sort(([a], [b]) => Number(a) - Number(b))) {
    const read = input.reads[key];
    if (!isOpenPr(me) || !read) continue;
    const n = Number(key);

    // The forge side, in issue space: blocked_by edges plus the live stacked base.
    const forgeSame = new Set<string>();
    const forgeCross = new Map<string, DependencyRef>();
    const unresolved: DependencyRef[] = [];
    for (const r of read.blockedBy) {
      if (r.repo !== repo) forgeCross.set(refKey(r, forge), r);
      else {
        const dep = resolve(r);
        if (dep == null) unresolved.push(r);
        else if (dep !== n && !satisfied(dep)) forgeSame.add(issueKey(dep));
      }
    }
    const basePr = input.openPrs.find((p) => p.headRefName === read.baseRefName && p.number !== me.pr && !p.headRepoIsFork);
    const baseIssue = basePr ? resolve({ repo, number: basePr.number, kind: 'pr' }) : null;
    const stackedOn = baseIssue != null && baseIssue !== n ? baseIssue : null;
    if (stackedOn != null) forgeSame.add(issueKey(stackedOn));

    // The queue side and the last sync, without satisfied dependencies: those stay as they are.
    const deps = me.depends_on ?? [];
    const queueSame = new Set(deps.filter((d) => !satisfied(d)).map(issueKey));
    const last = me.forge_deps ? new Set(me.forge_deps.synced.filter((k) => isIssueKey(k) && !satisfied(keyIssue(k)))) : null;
    const merged = [...merge3(queueSame, forgeSame, last)].map(keyIssue).sort((a, b) => a - b);

    // Stack first: the live base carries its edge; else one open-PR dependency becomes a restack.
    const openDeps = merged.filter((d) => isOpenPr(issues[String(d)]));
    let restack: Restack | null = null;
    let viaStack: number | null = stackedOn != null && merged.includes(stackedOn) ? stackedOn : null;
    if (viaStack == null && openDeps.length === 1) {
      const parent = openDeps[0]!;
      const head = input.openPrs.find((p) => p.number === issues[String(parent)]!.pr && !p.headRepoIsFork);
      if (head) {
        restack = { parent, parentPr: head.number, parentBranch: head.headRefName };
        viaStack = parent;
      }
    }
    const same = merged.filter((d) => d !== viaStack).map(toRef);

    // Cross-repo: the body's lines, plus forge-only edges the body never pushed.
    const body = (input.crossRepoBody[key] ?? []).map((d) => ({ key: crossKey(d), ref: { repo: d.repo, number: d.number, kind: 'pr' as const } }));
    const pushed = new Set(me.forge_deps?.body_cross ?? []);
    const bodyKeys = new Set(body.map((b) => b.key));
    const cross = [...body.map((b) => b.ref), ...[...forgeCross].filter(([k]) => !bodyKeys.has(k) && !pushed.has(k)).map(([, r]) => r)];

    const blockedBy = dedupeRefs([...same, ...cross, ...unresolved], forge);
    const want = new Set(blockedBy.map((r) => refKey(r, forge)));
    const have = new Set(dedupeRefs(read.blockedBy, forge).map((r) => refKey(r, forge)));
    const write = want.size !== have.size || [...want].some((k) => !have.has(k));

    const synced = [...merged.filter((d) => d !== viaStack || d === stackedOn).map(issueKey), ...cross.map((r) => refKey(r, forge))];
    plans.push({
      issue: n,
      pr: me.pr as number,
      dependsOn: [...new Set([...merged, ...deps.filter(satisfied)])].sort((a, b) => a - b),
      forgeDeps: { synced, body_cross: [...bodyKeys] },
      blockedBy,
      write,
      restack,
      stackedOn,
      unresolved,
    });
  }
  return plans;
}

const CROSS_KEY = /^([^#!\s]+\/[^#!\s]+)[#!](\d+)$/;

/**
 * The cross-repo blockers each queue issue's PR declares on the forge, from `forge_deps.synced`
 * (written by the last sync), keyed by issue. The status page adds them to the issue-body ones so
 * "Merge next" names a forge-declared cross-repo blocker as it names a body-declared one.
 */
export function forgeDeclaredCrossRepo(issues: Record<string, PrDepsIssue>): Map<number, CrossRepoDep[]> {
  const out = new Map<number, CrossRepoDep[]>();
  for (const [key, issue] of Object.entries(issues)) {
    const deps = (issue.forge_deps?.synced ?? []).flatMap((k) => {
      const m = k.match(CROSS_KEY);
      return m ? [{ repo: m[1]!, number: Number(m[2]) }] : [];
    });
    if (deps.length) out.set(Number(key), deps);
  }
  return out;
}

/** One planned PR as the CLI reports it; `applied` is false on a dry run or when the write did not read back. */
export type PrDepsReportRow = {
  issue: number;
  pr: number;
  depends_on: number[];
  blocked_by: string[];
  write: boolean;
  applied: boolean;
  restack: (Restack & { command: string }) | null;
  unresolved: string[];
};

export type PrDepsSyncResult = {
  /** The queue with each planned issue's `depends_on` and `forge_deps` updated; null on a dry run. */
  queue: { issues?: Record<string, PrDepsIssue>; refreshed_at?: string } | null;
  rows: PrDepsReportRow[];
  errors: string[];
};

const FORGE_LIMIT = 1000;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Reads every open queue PR's forge dependencies, plans the two-way sync, and with `apply` writes
 * the planned blocker sets and returns the updated queue (the orchestrator installs it through the
 * state-write-guard: blackhole-state.md § Single-writer invariant). A PR whose read fails is left
 * out of the plan; a write that does not read back as planned keeps that issue's old queue state,
 * so the next sync retries it rather than recording an edge the forge does not hold.
 */
export async function syncPrDependencies(
  adapter: ForgeAdapter,
  queue: { issues?: Record<string, PrDepsIssue>; refreshed_at?: string },
  opts: { apply: boolean; repo: string; queuePath: string; now?: string },
): Promise<PrDepsSyncResult> {
  const issues = queue.issues ?? {};
  const errors: string[] = [];
  const openPrs = await adapter.prList({ state: 'open', limit: FORGE_LIMIT });
  const openIssues = await adapter.issueList({ state: 'open', limit: FORGE_LIMIT });
  const crossRepoBody: Record<string, CrossRepoDep[]> = {};
  for (const i of openIssues) if (issues[String(i.number)]) crossRepoBody[String(i.number)] = parseCrossRepoDepsFromBody(i.body);

  const reads: Record<string, PrForgeRead> = {};
  for (const [key, issue] of Object.entries(issues)) {
    const pr = openPrs.find((p) => p.number === issue.pr);
    if (!isOpenPr(issue) || !pr) continue;
    try {
      reads[key] = { blockedBy: (await adapter.getDependencies(pr.number)).blockedBy, baseRefName: pr.baseRefName };
    } catch (error) {
      errors.push(`#${key} (PR #${pr.number}): reading dependencies failed: ${message(error)}`);
    }
  }

  const plans = planPrDependencies({ repo: opts.repo, forge: adapter.forge, issues, openPrs, reads, crossRepoBody });
  const next = opts.apply ? structuredClone(issues) : null;
  const rows: PrDepsReportRow[] = [];
  for (const plan of plans) {
    let applied = false;
    if (opts.apply) {
      try {
        const back = plan.write ? await adapter.setDependencies(plan.pr, plan.blockedBy) : { blockedBy: plan.blockedBy };
        const want = new Set(plan.blockedBy.map((r) => refKey(r, adapter.forge)));
        const got = new Set(dedupeRefs(back.blockedBy, adapter.forge).map((r) => refKey(r, adapter.forge)));
        applied = want.size === got.size && [...want].every((k) => got.has(k));
        if (!applied) errors.push(`#${plan.issue} (PR #${plan.pr}): the blockers read back as ${[...got].join(', ') || 'none'}, not as planned`);
      } catch (error) {
        errors.push(`#${plan.issue} (PR #${plan.pr}): writing dependencies failed: ${message(error)}`);
      }
      if (applied) next![String(plan.issue)] = { ...next![String(plan.issue)], depends_on: plan.dependsOn, forge_deps: plan.forgeDeps };
    }
    rows.push({
      issue: plan.issue,
      pr: plan.pr,
      depends_on: plan.dependsOn,
      blocked_by: plan.blockedBy.map((r) => refKey(r, adapter.forge)),
      write: plan.write,
      applied,
      restack: plan.restack && {
        ...plan.restack,
        command: `bun run scripts/stack-repair.ts restack --queue ${opts.queuePath} --repo-slug ${opts.repo} --repo-root <abs> --child-issue ${plan.issue} --parent-issue ${plan.restack.parent} --parent-pr ${plan.restack.parentPr} --apply`,
      },
      unresolved: plan.unresolved.map((r) => refKey(r, adapter.forge)),
    });
  }
  return { queue: next ? { ...queue, issues: next, refreshed_at: opts.now ?? new Date().toISOString() } : null, rows, errors };
}
