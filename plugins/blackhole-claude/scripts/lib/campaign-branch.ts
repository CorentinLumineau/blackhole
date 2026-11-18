// The one definition of a campaign worker branch name: `issue-<N>` with an optional `-<slug>`.
// Callers add their own prefix (`blackhole/`, `claude/`, `refs/heads/blackhole/`).
export const CAMPAIGN_BRANCH_TAIL = String.raw`issue-(\d+)(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?`;

const BLACKHOLE_BRANCH = new RegExp(String.raw`^blackhole\/${CAMPAIGN_BRANCH_TAIL}$`);

/** True for `blackhole/issue-<N>` or `blackhole/issue-<N>-<slug>`; any other prefix or a missing number is false. */
export const isBlackholeBranchName = (name: string): boolean => BLACKHOLE_BRANCH.test(name);
