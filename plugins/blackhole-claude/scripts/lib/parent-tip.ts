import { isAncestor, mergeBaseOf, revParse, type GitRunner } from './stack-merge.ts';

// The merge base for a stacked child's replay. A recorded `parent_tip_sha` is preferred and, when the
// parent PR's head is readable, cross-checked against it; with no recorded tip the base is derived
// from that head. Git and the ref fetch are injected so the rules run without a real remote.

export type TipInput = {
  /** `parent_tip_sha` recorded at stack creation, or null. */
  captured: string | null;
  /** The parent PR's head as the forge reports it, or null when it could not be read. */
  head: string | null;
  parentPr: number | null;
  /** The child's branch. */
  branch: string;
  /** Where the parent landed, for example `origin/main`. */
  target: string;
};

export type TipDeps = {
  git: GitRunner;
  /** Fetches `refs/pull/<pr>/head`; false when the ref does not exist (Gitea has no equivalent). */
  fetchPrHead: (pr: number) => boolean;
};

export type TipResolution =
  | { tip: string; source: 'captured' | 'derived'; note: string }
  | { refusal: string };

const refOf = (pr: number): string => `refs/pull/${pr}/head`;

/** The head, once fetched and resolvable locally; null when either step fails. */
const fetchedHead = (repoRoot: string, input: TipInput, deps: TipDeps): string | null =>
  input.head === null || input.parentPr === null || !deps.fetchPrHead(input.parentPr) || revParse(repoRoot, input.head, deps.git) === null
    ? null
    : input.head;

const resolveCaptured = (repoRoot: string, captured: string, input: TipInput, deps: TipDeps): TipResolution => {
  const head = fetchedHead(repoRoot, input, deps);
  if (head === null) return { tip: captured, source: 'captured', note: 'recorded tip used; parent PR head not readable, so not cross-checked' };
  if (captured !== head && !isAncestor(repoRoot, captured, head, deps.git)) {
    return {
      refusal:
        `recorded parent tip ${captured} is neither the parent PR #${input.parentPr} head ${head} nor an ancestor of it — ` +
        'the parent was force-pushed or the record is wrong; nothing pushed',
    };
  }
  return { tip: captured, source: 'captured', note: `recorded tip ${captured === head ? 'equals' : 'is an ancestor of'} the parent PR head ${head}` };
};

const resolveDerived = (repoRoot: string, input: TipInput, deps: TipDeps): TipResolution => {
  if (input.head === null || input.parentPr === null) {
    return { refusal: 'no recorded parent tip and the parent PR head could not be read' };
  }
  const head = fetchedHead(repoRoot, input, deps);
  if (head === null) {
    return {
      refusal: `${refOf(input.parentPr)} did not fetch or does not resolve to ${input.head}, so no merge base can be derived from parent PR #${input.parentPr}`,
    };
  }
  const base = mergeBaseOf(repoRoot, input.branch, head, deps.git);
  if (base === null) return { refusal: `${input.branch} shares no commit with parent PR #${input.parentPr} head ${head}` };
  // A base that is already on the target, under a head that is not, is a trunk commit the parent was
  // rebased away from: the parent-only commits the child holds are gone from the head.
  if (isAncestor(repoRoot, base, input.target, deps.git) && !isAncestor(repoRoot, head, input.target, deps.git)) {
    return {
      refusal:
        `derived merge base ${base} is already on ${input.target} while parent PR #${input.parentPr} head ${head} is not — ` +
        `the parent was rebased and force-pushed before it landed, so ${input.branch} shares no parent-only commit with it; nothing pushed`,
    };
  }
  return { tip: base, source: 'derived', note: `merge base ${base} derived from parent PR #${input.parentPr} head ${head}` };
};

export const resolveParentTip = (repoRoot: string, input: TipInput, deps: TipDeps): TipResolution =>
  input.captured === null ? resolveDerived(repoRoot, input, deps) : resolveCaptured(repoRoot, input.captured, input, deps);

/** One line for the dry run: the tip that will be used and where it comes from. No git, no forge. */
export const describeTip = (input: Pick<TipInput, 'captured' | 'head' | 'parentPr'>): string =>
  input.captured !== null
    ? `parent tip ${input.captured} (recorded in queue.json)`
    : `parent PR #${input.parentPr} head ${input.head} (derived; the merge base is resolved from it at --apply)`;
