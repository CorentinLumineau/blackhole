---
type: adr
summary: "A campaign PR that would conflict with any open PR in the target repo is stacked on it by merge, in every merge_mode, with no config key that turns stacking off; overlap is decided by a merge-tree conflict between the two heads after a shared-file prefilter, children are recovered after a parent merge by a merge that uses the recorded parent tip as merge base, and a campaign-side gate (V-STACK-02) refuses an unstacked overlapping PR"
status: accepted
review_trigger: "on a change to the forge's PR retargeting behavior, or on a request for a stacking toggle"
created: 2026-11-11
last_updated: 2026-11-11
related:
  - documentation/decisions/ADR-027-forge-adapter-interface.md
  - documentation/decisions/ADR-048-github-rest-forge-channel.md
  - documentation/reference/product-principles.md
  - documentation/plans/plan-mandatory-stacking.md
---

# ADR-051: Stacking is the only overlap strategy

## Status

Accepted, 2026-11-11 (owner decision gate on issue #1113, ruling R-005).

## Context

Stacking today covers only queue issues, is decided once at dispatch, and recovers after a parent
merge with a rebase and force-push that the docs forbid. A PR opened later, or against an external
open PR such as the Gitea incident of workflows#159 against #157, conflicts with work the campaign
never saw.

## Decision

1. **Scope.** Overlap is computed against every open PR in the target repo, from the files each PR
   changes. The input is one snapshot per turn.
2. **Predicate (D1).** A shared changed file is a prefilter. A real conflict reported by
   `git merge-tree` between the two heads decides whether to stack. Clean-merging overlaps are not
   stacked.
3. **Topology (D3, D4, D5).** The child stacks on the tip of the lowest-numbered overlapping chain.
   A fork PR is never a base: the issue is deferred, or exempted with a named reason if already
   open. Chain depth is capped at 4 by a code constant, not a config key.
4. **Merge only.** Restack and recovery use merges. Nothing rebases or force-pushes a stacked
   branch. After a parent merge, the child gets a merge whose base is the recorded parent tip, then
   a fast-forward push.
5. **Parent merge method (D2).** A parent with open stacked children is merged with a merge commit
   when the repo allows it, otherwise squash.
6. **Gate (D11).** A campaign-side `stack-check` hard stop (V-STACK-02) at PR open, before review
   and before merge, plus `pr-lint.sh` on this repo. A consumer CI job is a follow-up.
7. **No opt-out (D10, AC 5).** No config key matching stacking exists; a verify check keeps it so.
8. **Escape (D6) and propagation (D7, D8).** An owner-approved unstack after 72 hours of parent
   idleness; lazy fix-round propagation; the LGTM carries over when the child's patch-id is
   unchanged.

## Alternatives Considered

- **Shared file as the predicate.** Simpler and catches semantic coupling, but stacks every PR on
  hot files such as `documentation/INDEX.md` into one chain.
- **A stacking toggle.** Flexible, but it is the opt-out the owner ruled out.
- **Squash everywhere.** Keeps main linear, but forces a child push and CI rerun after every parent
  merge.

## Consequences

- A squash-merged parent still costs each direct child one push and one CI run. A merge-commit
  parent does not.
- External AI reviewers re-review the new child head; the campaign posts diff-equivalence evidence.
- The adapters gain `prFiles` and `prChangeBase`; Gitea support is verified by a live probe
  recorded in the M1 PR.
