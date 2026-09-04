---
type: analysis
status: current
created: 2026-09-04
last_updated: 2026-09-04
review_trigger: "on file change"
issue: 798
confidence: 92
computed_at_revision: 1
---

# Investigation: Campaign scripts resolve `./lib` imports against cwd (#798)

## Symptoms

`bun run scripts/<name>.ts` resolves the entry path argument (`scripts/<name>.ts`) against the
**process cwd**, and every relative import inside that entry file (`./lib/...`) then resolves
against *that resolved file's own on-disk location* — standard ES-module/Bun relative-import
semantics, not cwd-relative for the imports themselves. The net effect at the module-graph level
is: whichever tree cwd happens to point into supplies the **entire** dependency graph the entry
script pulls in, regardless of which tree `--repo-root`/`--config`/`--ledger` *arguments* name as
the operation's target.

Concretely confirmed in the three scripts the issue names:

- `scripts/promote-review-artifact.ts:4-5` — `import { readJsonFile } from './lib/fs.ts'`,
  `import { renderReviewMarkdown, type LedgerFile } from './lib/promote-review-artifact.ts'`
- `scripts/carry-staged-artifacts.ts:2` — `import { carryManifest, loadManifest } from
  './lib/carry-staged-artifacts.ts'`
- `scripts/check-review-artifact.ts:4-6` — `import { readJsonFile } from './lib/fs.ts'`,
  `import { mergeReadinessForReviewPromotion } from './lib/merge-gate/review-artifact.ts'`,
  `import type { LedgerFile } from './lib/promote-review-artifact.ts'`

All three are untouched by either of this session's two candidate fixes (#792/PR#827,
#806/PR#823) — the router flagged exactly the right overlap question to close before this issue
proceeds to planning.

This investigation resolves three specific open questions (not a from-scratch root-cause hunt —
the mechanism above is already established by the issue body's own PR #790 incident report):

1. Does #792 (main-clone freshness) close #798?
2. Does #806 (absolute-path CLI args) close #798?
3. Is #798 still live?
4. Is AC2's proposed `git rev-parse HEAD` detection sufficient?

## Hypotheses

Before ranking: H1 and H2 are each "does an already-merged PR happen to close this for free" —
the accessibility-favored answer (yes, saves a planning cycle) is exactly the bias the router
flagged this investigation to check. Ranked by evidence strength, not by which answer is cheaper
to accept:

### H1 — #792's main-clone freshness refresh closes #798

**Rank 2** (needs a concrete-scenario trace, not just a grep — more expensive to test than H2).

- **Evidence for**: #792 does make the main clone's `scripts/lib/` tree closer to `--repo-root`'s
  tree in the common case (main was stale relative to `origin/main`; now it isn't, at
  post-merge and turn-start).
- **Evidence against**: #792's refresh is `git fetch origin main && git merge --ff-only
  origin/main` — it can only ever bring the main clone up to `origin/main`'s HEAD. A worktree
  operating on an open PR branch is, by construction, ahead of `origin/main` by exactly the
  commits that PR has not yet merged. When those commits touch `scripts/lib/*`, the main clone's
  tree diverges from the worktree's tree **regardless of how fresh the main clone is** — freshness
  relative to origin cannot close a gap that exists relative to an unmerged sibling branch.
- **Test performed** (cheap, no execution needed — code/history trace): the issue's own worked
  example is exactly this scenario. PR #790 (issue #743) contains commits `454aa198` (`fix(docs):
  sorted-insert appendIndexRowIfAbsent...`) and `c27d661e` (`fix(docs): sort ... by byte order`),
  both of which modify `scripts/lib/check-common.ts` — confirmed via `git show --stat` on both
  SHAs. At the moment the promoting agent ran `carry-staged-artifacts.ts` from the main-clone cwd,
  those two commits existed **only** on the PR #790 worktree branch, not on `main`/`origin/main`.
  No `git fetch && git merge --ff-only origin/main` performed *at any point before that PR merged*
  could have pulled them into the main clone — they were not there to fetch. The main clone could
  have been fetched one second before the promotion call and still lacked the fix, because the fix
  lived exclusively on the branch being promoted.
- **Verdict: REFUTED.** #792 fixes a different axis entirely (main-clone-vs-origin drift, i.e.
  staleness from *not syncing after other PRs merged*). #798 is about main-clone-vs-worktree
  divergence *while a PR is still open*, which is structural and present even with a
  perfectly-synced main clone. The two are non-overlapping by construction: the moment a
  worktree's PR modifies `scripts/lib/**`, "main is fresh" and "main's `scripts/lib` matches this
  PR's `scripts/lib`" stop being the same fact.

### H2 — #806/PR #823's absolute-path CLI requirement closes #798

**Rank 1** (cheapest to test — direct code read, no scenario construction needed). Tested first.

- **Evidence for**: #806 was explicitly framed as touching the same problem family ("Sidesteps
  #798 rather than sequencing behind it" — per #806's own queue notes), and does add path-shape
  validation to `check-review-artifact.ts`'s CLI (`ABSOLUTE_PATH_KEYS = ['config', 'ledger',
  'repo-root', 'diff-file']`, enforced via `path.isAbsolute()` at parseArgs time).
- **Evidence against**: absolute-path validation constrains the **argument values** the script
  reads at runtime (which files it opens for `--config`/`--ledger`, which directory string it
  treats as `--repo-root`) — it has zero interaction with **module resolution**, which happens at
  `import` time, driven by the import specifier's textual form (`'./lib/fs.ts'`) and the
  *importing file's own resolved path*, never by `argv`. Bun's `import` resolution algorithm does
  not consult CLI flags. The script's own author recorded this precisely, in-line, at
  `scripts/check-review-artifact.ts:11-12`: `// Every path-shaped flag must be absolute (issue
  #806 AC4) — sidesteps the cwd-relative resolution hazard class documented for #798 rather than
  sequencing behind it.` This is the fix's own author stating, in the committed code, that it does
  not close #798.
- **Test performed**: read `scripts/check-review-artifact.ts` imports (lines 2-6) before and
  conceptually after PR #823 — the import statements are identical relative specifiers, untouched
  by that PR's diff (`git log` shows PR #823/commit `7f923635` touched
  `scripts/lib/merge-gate/review-artifact.ts`, its test, and `check-review-artifact.ts`'s
  arg-parsing/manifest-check logic — not its `import` lines). Additionally, #806's fix is scoped
  to `check-review-artifact.ts` alone; it never touches `carry-staged-artifacts.ts` or
  `promote-review-artifact.ts`, two of the three scripts #798 names as affected — so even if the
  CLI-absoluteness theory were right, it would still leave 2/3 of the affected surface untouched.
- **Verdict: REFUTED**, and refuted by the fix's own author's contemporaneous comment — the
  strongest possible form of confirmation available without running code.

### H3 — #798 is still fully live; no existing merge touches its root cause

**Rank 3** (residual — confirmed once H1 and H2 are both refuted, per the loop's "generate a new
ranked set on full refutation" rule; here the residual hypothesis is the natural next slot rather
than requiring a fresh generation, since it directly answers Q3).

- **Evidence for**: both H1 and H2 refuted above via direct code/history evidence, not inference.
  All three named scripts (`promote-review-artifact.ts`, `carry-staged-artifacts.ts`,
  `check-review-artifact.ts`) still carry the exact relative `./lib/...` import shape the issue
  describes, as of the current tree (this investigation's own `grep`/`Read` pass, run after both
  #792 and #806 merged).
- **Evidence against**: none found. No merge this session added a `git rev-parse HEAD` guard, a
  `--cwd` pin, or any other mechanism between cwd and `--repo-root`.
- **Verdict: CONFIRMED.** Proceed to planning — #798 is not incidentally resolved.

## Root Cause

Unchanged from the issue body's own diagnosis, now doubly confirmed against this session's two
candidate closers: `bun run scripts/<name>.ts` resolves the entry-path argument against cwd, and
Bun/Node relative-import resolution then chains every subsequent `./lib/...` import against each
importing file's own resolved location — so the entire module graph loaded is whichever tree cwd
happened to be in when the process started, independent of any `--repo-root`/`--config`/`--ledger`
argument value. #792 (branch-freshness-vs-origin) and #806 (CLI-argument-path-absoluteness) each
operate on axes orthogonal to module resolution and leave this mechanism completely intact.

## Resolution

**#798 is still open and should proceed to Plan**, not be closed as already-fixed.

For the planner (Q4 — AC2 sufficiency): AC2's proposed detection (`git rev-parse HEAD` compare
between cwd's tree and `--repo-root`'s tree, fail loudly on mismatch) is sound as far as it goes
but has one concrete gap worth flagging before it's adopted as the sole fix:

- **HEAD-SHA comparison passes on matching commits with divergent working trees.** If cwd's tree
  and `--repo-root`'s tree share the same `HEAD` SHA but either has uncommitted/staged local
  edits under `scripts/lib/` (e.g. an implementer mid-edit before committing, a stash, a
  work-in-progress hotfix in the main clone), the HEAD check reports "match" while the code
  actually executed still differs from the target tree's real state. Recommend pairing the HEAD
  compare with a dirty-check (`git status --porcelain -- scripts/lib` or `git diff --quiet --
  scripts/lib`) in both trees, or scoping the regression test (AC3) to cover this case explicitly
  so it isn't discovered as a flaky gap later the way #806's own AC5 called out for its circular-
  check regression.
- **A stronger, already-precedented alternative exists in this exact repository**:
  `scripts/consumer-promote-review.sh:18` already runs `exec bun run --cwd "${PLUGIN_ROOT}"
  scripts/promote-review-artifact.ts "$@"` — and Bun's own `--cwd` flag (confirmed via `bun --help`:
  "Absolute path to resolve files & entry points from. This just changes the process' cwd.") is
  built precisely to pin both the entry-path resolution and every relative import beneath it to a
  named directory. Pinning invocation to `bun run --cwd <repo-root-or-worktree>
  scripts/<name>.ts` **structurally eliminates** the divergence class (AC1's "MUST be invoked with
  the worktree as cwd" requirement, made mechanically true rather than instruction-followed) rather
  than detecting it after the fact — the planner should weigh this as the primary fix shape for
  AC1/AC2 together, with the HEAD/dirty-check as a defense-in-depth regression guard (AC2/AC3)
  rather than the only line of defense.

No hypothesis-set exhaustion occurred — H2 was confirmed-refuted on the first (cheapest) test and
H1 on the second; the investigation resolved to a definitive H3 without needing escalation.
