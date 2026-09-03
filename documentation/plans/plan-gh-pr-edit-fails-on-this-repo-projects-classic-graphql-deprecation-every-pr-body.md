---
type: plan
status: current
review_trigger: on file change
created: 2026-09-03
last_updated: 2026-09-03
---

# Issue #813 — `gh pr edit` fails on this repo (Projects classic GraphQL deprecation)

## Objective

`gh pr edit` fails unconditionally on this repo (`has_projects: true` + deprecated classic
Projects — the mutation path resolves `repository.pullRequest.projectCards` before it ever
touches the body). Two implementers this session (impl-777 on PR #799, impl-784 on PR #810)
independently rediscovered the same `gh api -X PATCH repos/<owner>/<repo>/pulls/<N> -f
body=@<file>` REST workaround and reported it as novel — grep across `src/` confirms zero
codified call sites for a PR-body edit anywhere in the repo (`prCreate`/`prComment` exist in
`scripts/lib/forge-adapter/github.ts`; no `prEdit`). The risk the issue names is real: an agent
that hits the GraphQL error cold can misread "Projects (classic) is being deprecated" as a
permissions problem and skip the PR-body update entirely — which is never optional, since
`implementer.md`'s Bugfix Gate (Root-Cause Decision Record), `docs-only` Drift-Check Table,
Reuse Check entry, Sensitive-Filename Exclusion lines, and every fix-round re-invocation of step
6 all require writing into the PR body.

Fix is documentation-only: add a short callout at `implementer.md` step 6 ("Verify & Open PR" —
the one place in the whole agent roster that opens or updates a PR body, covering both initial
`gh pr create` and every later edit a fix round makes) stating the failure mode and the REST
workaround, so an agent reads it before hitting the error rather than after.

## Decision: documentation-only, no wrapper script

The workaround is a genuine one-liner (`gh api -X PATCH repos/<owner>/<repo>/pulls/<N> -f
body="$(cat <file>)"`) with no error-prone parts to wrap (single flag, no multi-step sequencing,
no output parsing). A script would also have to be forge-conditional to stay correct — the bug is
a GitHub-specific classic-Projects sunset (Gitea/`tea`, GitLab/`glab` have no equivalent failure
per ADR-027's adapter survey), and `implementer.md` already hardcodes plain `gh` verbs elsewhere
(`gh pr create`, `gh pr checks`, `gh pr merge`) without a forge-conditional layer — introducing
one just for this one command would be a new pattern for a concern the file doesn't otherwise
generalize. The existing `scripts/lib/forge-adapter/*.ts` layer is not the right home either: it
backs orchestrator-level TS automation (forge-sync, queue mutations), not the implementer agent's
own direct Bash/`gh` invocations, which is how this failure is actually hit.

## Fix

Added a callout to `src/agents/implementer.md` step 6 ("Verify & Open PR") immediately after the
`Commit, push, and open a PR...` bullet, stating:

1. `gh pr edit` fails unconditionally on a repo with `has_projects: true` and classic Projects
   enabled: its mutation path resolves `repository.pullRequest.projectCards` before touching the
   body, and classic Projects is deprecated, so the call exits 1 with a GraphQL error before any
   edit is attempted.
2. This is a CLI-toolchain limitation, never a permissions or auth failure — do not skip a
   required PR-body update because of it.
3. Workaround: `gh api -X PATCH repos/<owner>/<repo>/pulls/<N> -f body="$(cat <bodyfile>)"` — the
   REST endpoint is unaffected because it never resolves project-card metadata.

## Related

- Duplicate: issue #772 made the identical point one turn earlier with a broader, less accurate
  Touch-Paths guess (`src/references/**`, `documentation/runbooks/**`); closed as a duplicate of
  #813 once this PR merged.
- Out-of-scope follow-up: `scripts/lib/forge-adapter/*.ts` has `prCreate`/`prComment` but no
  `prEdit`/`updatePr` method across any of the three backends (github/gitea/gitlab). That gap
  affects a different call path (orchestrator-level TS automation) than the one this issue
  reports (the implementer agent's direct Bash/`gh` invocations) and was left for a separate
  issue rather than folded into this fix.
