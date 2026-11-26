---
type: adr
summary: "A path regenerated wholesale from the merged tree, with a blocking staleness check, is no V-STACK-02 overlap: REGENERATED_PATHS (today only documentation/INDEX.md, from the doc-index generator's ROOT_DOC_INDEX_PATH) is dropped before the shared-file prefilter, and a git merge-tree conflict confined to it reads as clean; a conflict in any other file still stacks; a later PR that goes CONFLICTING on it regenerates it through generate-doc-index.ts --write; design-aggregate.ts blocked on dominance only (unanimous winner A), owner-approved 2026-11-18"
status: accepted
review_trigger: "on a change to the V-STACK-02 overlap predicate, or a request to exempt another path from it"
created: 2026-11-18
last_updated: 2026-11-25
related:
  - documentation/decisions/ADR-051-stacking-only-overlap-strategy.md
  - documentation/decisions/ADR-031-generate-documentation-index.md
  - documentation/reference/product-principles.md
---

# ADR-055: Regenerated files are not a stacking overlap

## Status

Accepted, 2026-11-18. Owner approved the full Option A design for issue #1303 (decision gate answer "Approve full design"), including reading an INDEX-only merge-tree conflict as clean under R-005; disposition "proceed". Refines ADR-051 D1; ADR-051 stays accepted and carries a post-acceptance amendment pointing here.

## Context

Since #1278 every campaign PR carries a plan doc, and the carry-step regenerates `documentation/INDEX.md` wholesale. Every two open campaign PRs therefore share that file, and V-STACK-02 stacked unrelated PRs on it (#1302 on #1299; the pairwise changed-file intersection of open PRs #1299-#1302 was exactly `documentation/INDEX.md`). Stacking serializes merges, so one owner-held PR blocks every PR behind it, the opposite of R-005's stated purpose that every PR merges smoothly.

## Requirements Framing

Route (R-00117): needs_design, plan_mode full, docs_impact, size m.

Since #1278, every campaign PR carries a plan doc. The carry-step rewrites `documentation/INDEX.md` wholesale (`scripts/lib/carry-staged-artifacts.ts:383-396`, via `renderFullIndexFile`). As a result, any two open campaign PRs share that file.

V-STACK-02 then stacks PRs that are otherwise unrelated: #1302 had to be stacked on #1299. Stacking serializes merges, so one owner-held PR (`needs-chef`) blocks every PR behind it.

Required outcome:
- A regenerated, order-independent file is no overlap on its own.
- A real conflict in any other file still stacks, in every decision channel.

Binding constraints:
- R-005: merge-tree is the predicate, a shared file is only a prefilter, no toggle, the gate is never removed.
- ADR-051 D1.
- V-STACK-03: no config key with a `stack` segment.
- V-DOCHEALTH-01/02/04 stay blocking.
- V-BRANCH-02: no direct commits to main.

### Router findings, verified at `origin/main` 206f9021

| Finding | Verdict |
|---|---|
| `pickParent` is the engine: `shares()` prefilter, then the `conflicts` callback | ✓ (`scripts/lib/stack-overlap.ts:134-190`) |
| The mcp channel `--open-prs` always returns `'conflict'` | ✓ (`scripts/stack-check.ts:87-88`) |
| In the git channel, adjacent INDEX rows conflict for real in merge-tree | ✓, reproduced with git 2.56. Two branches each insert a row after `\| m \|`; `git merge-tree --write-tree --no-messages --name-only` exits 1 and lists `documentation/INDEX.md` |
| `stack-overlap.test.ts` L89 documents the INDEX pair as a conflict | ✗ **Wrong**. L88-91 is `conflicts: always('clean')` → `{kind:'none'}`: "a file overlap whose merge-tree is clean yields no parent". No test pins INDEX as a conflict today. |
| No ignore list exists | ✓ |

The router missed two more decision sites:
- `scripts/stack-parent.ts:44`, the `--pr` recheck through `verifiedPrMergeTree` → `recheckStack` (`scripts/lib/stack-lifecycle.ts:159`).
- `scripts/lib/stack-parent.ts:110`, the dispatch-time `pickStackParent`. It matches touch-path globs against parent PR files with no merge-tree. 12 queue issues name `documentation/INDEX.md` or a `documentation/` glob in `touch_paths`.

`scripts/pr-lint.sh:59` calls `stack-check.ts`, so the gate is covered there too.

## Decision

1. **Set.** `REGENERATED_PATHS` is a code constant in `scripts/lib/stack-overlap.ts` (never a config key, V-STACK-03). Its only member is `ROOT_DOC_INDEX_PATH`, exported by `scripts/lib/doc-index-generate.ts`, the generator that writes the file. A path qualifies only when it is regenerated wholesale from the merged tree and a blocking verify check fails when it is stale. `documentation/decisions/INDEX.md` (hand-appended `append_row`) and build output trees do not qualify; the append-only amendment below covers the former differently.
2. **Prefilter.** `pickParent` drops the set from both PRs' file lists before `shares()`. This is the only change the mcp channel (`--open-prs`) needs.
3. **Predicate.** `mergeTreeVerdict` runs with `--name-only`. An exit-1 result whose conflicted-path list is non-empty and entirely inside the set is `clean`; an empty or unparseable list stays `conflict`, an unresolvable revision stays `unknown`. A conflict in any other file still stacks.
4. **Dispatch.** `pickStackParent` drops exact set members from both issues' `touch_paths`, and a parent file list that filters to empty is a known no-overlap.
5. **After merges.** Sorted rows union correctly on a clean textual merge. When a later PR goes CONFLICTING on the file, Step 0.5's implementer resolves it as a mechanical class-1 conflict with `bun run scripts/generate-doc-index.ts --write`. V-DOCHEALTH-04 on the PR head and on `main` is the blocking backstop.

## Options + Trade-off Matrix

Rubric: `design-rubric.md` `architecture-choice` (Risk 30, Maintainability 25, Complexity 20, Reversibility 15, Consistency 10). The primary's scores are shown; 5 is best.

- **Option A: generator-owned exact-path constant.**
  - `doc-index-generate.ts` exports `ROOT_DOC_INDEX_PATH = 'documentation/INDEX.md'`.
  - `stack-overlap.ts` exports `REGENERATED_PATHS: ReadonlySet<string>` built from it. It is a code constant, like `STACK_DEPTH_CAP`.
  - It applies at two points in `stack-overlap.ts`:
    1. Dropped from both file lists before `shares()`.
    2. Inside `mergeTreeVerdict`: exit 1 whose `--name-only` conflicted list is non-empty and entirely in the set → `'clean'`.
  - Dispatch `pickStackParent` filters the set out of `parentFiles` before matching globs.
  - Post-merge: `generate-doc-index.ts --write` plus a new mechanical class in `merge-conflict-protocol.md`.
- **Option B: derive the set from `COMMITTED_TARGET_TREES`** (`scripts/lib/build/paths.ts:61-70`) plus the index path.
- **Option C: read `linguist-generated` from `.gitattributes`** with `git check-attr`.
- **Option D: keep INDEX.md out of PRs** and regenerate it on main after each merge. The predicate is untouched.

| Option | Risk | Maint. | Complexity | Revers. | Consistency | Weighted |
|---|---|---|---|---|---|---|
| A | 3 | 4 | 3 | 4 | 4 | **3.50** |
| B | 2 | 2 | 3 | 3 | 2 | 2.35 |
| C | 2 | 2 | 2 | 3 | 2 | 2.15 |
| D | 1 | 2 | 2 | 2 | 1 | 1.60 |

ADR citation check: ADR-051 has no `## Post-acceptance amendments` section at 206f9021, so there is nothing to quote. Recorded as `{adr: ADR-051, option: Option A, amendment_acknowledged: false}`.

**Provisional Chosen: Option A.**

**Strongest case for the runner-up, Option C (`.gitattributes`):**
- It is the only option that lets a consumer repo declare its own regenerated files without a code change: lockfiles, codegen, a differently named index.
- It uses a standard, git-native declaration that reviewers already see in diffs.
- `stack-check` runs in consumer repos, and their regenerated files are invisible to Option A.

**Why it loses:**
- The repo, and a PR's own diff, controls the attribute. Marking any file as generated silences the gate for it. That is a per-repo opt-out of V-STACK-02, which R-005 forbids. It is not a config key, but it is the same toggle.
- `linguist-generated` means "collapse in the diff view", not "safe to regenerate".
- No entries exist today (V-YAGNI-01).
- `check-attr` needs a checkout, which the mcp channel does not have.

**Why Option D loses:**
- It looks the most R-005-pure, because the predicate is untouched. It is not viable:
  - PRs without their INDEX row fail blocking V-DOCHEALTH-02/04.
  - Regenerating on main is a direct commit that V-BRANCH-02 forbids.
  - It reverses #1278's carry-step and the V-AUTO-02 audit.

**Why Option B loses:** `skills/`, `agents/`, `rules/` and `references/` are hand-authored source in consumer repos. Excluding them masks real conflicts there. It is also out of scope: build trees are not the reported pain.

## Adversarial Evaluation

Two critique-only `planner` invocations scored the four options with the Chosen field stripped:
- critic A: A 3.50 / C 2.85 / B 2.35 / D 1.75.
- critic B: A 3.50 / B 2.70 / D 2.25 / C 2.10.

Both picked A. CRITICAL findings landed only on the losing options:
- D: V-DOCHEALTH and V-BRANCH-02 (both critics).
- B: masks consumer-repo source (critic B).
- C: PR-controlled self-exemption (critic B).

NOTABLE findings on A, all folded into the plan:
1. **R-005 tension (both critics).** Read literally, an INDEX-only textual conflict is "a real conflict". After the earlier sibling merges, the later PR can become CONFLICTING (same-gap rows). Its regenerate commit gets a new head SHA, so LGTM (`merge-gate.md:341`) and CI run again. Patch-id review carry exists only for stack replays (`merge-gate.md:425-428`). Honest accounting:
   - Rows are sorted by path (#743), so siblings that land in different gaps merge with no conflict and no rerun.
   - Only the same-gap case pays one mechanical rerun.
   - Stacking pays a replay merge plus CI anyway, and serializes behind an owner-held parent indefinitely.
   - The exemption therefore advances R-005's stated purpose ("every PR merges smoothly") while refining its predicate. That is recorded as an ADR-051 post-acceptance amendment.
   - Extending review carry to regenerate-only commits is a follow-up, not this issue.
2. **Parse correctness.** The `--name-only` list is read from line 2 to the first blank line. An empty, unparseable or mixed list stays `'conflict'`. Real-git tests cover INDEX-only, INDEX plus `a.ts`, and an unresolvable revision.
3. **mcp channel.** It has no path data, so only the prefilter drop unstacks it. A shared non-generated file still yields `'conflict'` there, which is conservative and unchanged.
4. **Consumer hand-maintained root INDEX.** See the Assumption Audit (A4).
5. **One shared helper, not three copies.** `REGENERATED_PATHS` lives once in `stack-overlap.ts`. `stack-parent.ts` (lib) already imports from it.

## Component Decomposition

N/A: a single-component change to the overlap predicate plus its doc-index source. No new boundary. `stack-parent.ts` → `stack-overlap.ts` → `doc-index-generate.ts` adds one import edge with no cycle. `doc-index-generate.ts` imports nothing stack-related.

## Design Principles Validation

| Axis | Score | Note |
|---|---|---|
| SRP | ✓ | The generator owns "which file it writes"; the overlap engine owns "which writes are order-independent". |
| OCP | ~ | `mergeTreeVerdict` gains a parameter with a default. Callers are unchanged, but the decider is edited in place, not extended. |
| DRY | ✓ | One path constant replaces the literal at `carry-staged-artifacts.ts:359` and `:394`. One set is used by all four sites. |
| KISS | ✓ | Exact-path match, no globbing, no attribute lookup, no config. |
| YAGNI | ✓ | Only the one file observed to cause the pain. `documentation/decisions/INDEX.md` stays out, because it is hand-appended `append_row`, not regenerated. |
| Pattern (V-INT-02) | ✓ | Reuses the generator's own output path and the existing `STACK_DEPTH_CAP`-style code constant. |

## Refactoring Impact Analysis

| Consumer | Class | Note |
|---|---|---|
| `scripts/stack-check.ts:93` | TRANSPARENT | `mergeTreeVerdict(git, a, b)` signature unchanged. The new third parameter defaults to `REGENERATED_PATHS`. |
| `scripts/stack-parent.ts:44` | TRANSPARENT | `verifiedPrMergeTree` delegates to the changed decider. |
| `scripts/lib/stack-lifecycle.ts:159` | TRANSPARENT | `pickParent` signature unchanged. |
| `scripts/lib/stack-parent.ts:110` | TRANSPARENT | `parentFiles` filtered before `globsMatchFiles`. |
| `scripts/pr-lint.sh:59` | TRANSPARENT | Exit contract unchanged. |
| `scripts/lib/carry-staged-artifacts.ts:359,394` | TRANSPARENT | Literal → constant, same value. |
| `scripts/lib/stack-overlap.test.ts:88-91` | TRANSPARENT | Still passes. New tests are added next to it. |

## Assumption Audit

| # | Assumption | Mark | Note |
|---|---|---|---|
| A1 | The root INDEX is a pure function of the merged tree's doc frontmatter | ✓ | `buildDocIndexRows`: each row from its own doc, sorted by `byPathByteOrder`. |
| A2 | A clean textual merge of two sorted INDEX diffs equals the regenerated INDEX | ~ | Holds when each side only inserts its own rows. A same-doc edit on both sides conflicts on the doc itself, so stacking still fires. V-DOCHEALTH-04 on the PR head and on main is the backstop. |
| A3 | `git merge-tree --name-only` output: OID line, then conflicted paths, then a blank line or EOF | ✓ | Verified with git 2.56 using `--no-messages`. Paths with unusual characters come out C-quoted, so they never equal a set member and stay `'conflict'` (fail-safe). |
| A4 | A consumer repo's root `documentation/INDEX.md` is generated by the carry-step | ◐ | It is true when `docs_governance` is on. A hand-maintained root INDEX would get the exemption too; the residual cost is one Step 0.5 conflict (class 3 two-sided insertion), never a lost row. Accepted. |
| A5 | The exemption does not reintroduce the R-005 cost on balance | ~ | Same-gap siblings pay one regenerate rerun. Different-gap siblings pay nothing. Stacking pays a replay plus serialization. The ADR-051 amendment records this. |

## Alternatives Considered

- **Build target registry (`COMMITTED_TARGET_TREES`).** Rejected: `skills/`, `agents/`, `rules/`, `references/` are hand-authored source in consumer repos, so excluding them masks real conflicts.
- **`.gitattributes` `linguist-generated`.** Runner-up. Strongest case: a consumer repo can declare its own regenerated files without a code change. Rejected: the repo, and a PR's own diff, controls it, which is a per-repo opt-out of V-STACK-02 that R-005 forbids; the attribute means "collapse in diff", not "safe to regenerate"; no entries exist; the mcp channel has no checkout.
- **Keep INDEX.md out of PRs and regenerate on main.** Rejected: blocking V-DOCHEALTH-02/04 fail on PRs, and the post-merge write is a direct commit V-BRANCH-02 forbids.

## Consequences

- Doc-carrying PRs no longer stack on each other for the index alone.
- A later sibling whose row lands in the same gap pays one mechanical regenerate push that re-runs CI and ai-review; the owner accepted this cost. A follow-up may let an LGTM survive a push that touches only `REGENERATED_PATHS`.
- Adding a member to `REGENERATED_PATHS` is a decision at this ADR's bar, not a code tweak.

## Gate

`design_autonomy` is absent → default `true` (`config-template.md:69`). `scripts/design-aggregate.ts` was run on `.blackhole/plans/issue-1303-design-input.json`:

```json
{"status":"blocked","winner":null,"reasons":["dominance"],
 "scorer_results":[{"scorer":"primary","winner":"Option A","margin":32.86},
                   {"scorer":"critic_a","winner":"Option A","margin":18.57},
                   {"scorer":"critic_b","winner":"Option A","margin":22.86}]}
```

All three scorers pick Option A unanimously, but the two critics' margins are below the 30% dominance delta. **Verdict: `blocked`** (the planner does not override it, V-AUTO-01). Resolved by the owner: approved 2026-11-18 (`resume_context: design_approved`). Promoted as this ADR because `artifact-contract.md` maps the design route to an ADR; ADR-051 receives a post-acceptance amendment pointing here.

### What the owner needs to decide (R-003 executive summary)

- **Decision**: approve Option A, the exact-path exemption of the regenerated `documentation/INDEX.md` from V-STACK-02. The source is the doc-index generator's own output path, applied at the prefilter and inside the merge-tree decider, with a regenerate-on-conflict mechanical class.
- **Why now**: #1302 is already stacked on #1299 for INDEX.md alone, and #1300/#1301 will hit the same rule. One `needs-chef` hold serializes every campaign PR.
- **Evidence**: all three scorers chose A. Every CRITICAL finding is on B, C or D. The verdict is blocked only on margin (critics 18.6% and 22.9% vs the 30% bar), and the runner-up differs per critic (C, then B).
- **Recommended**: approve A, with the ADR-051 D1 amendment, and file a follow-up for review carry on regenerate-only commits.
- **Alternative**: keep current behaviour. Every doc-carrying PR keeps stacking.

## Post-acceptance amendments

- **2026-11-25 - append-only rows in `documentation/decisions/INDEX.md` (#1537).** Every ADR PR
  appends one row to that hand-appended file, so concurrent ADR PRs (#1508, #1514, #1536) always
  conflicted there and could only be stacked, which defeats independent review. It is not
  regenerated, so it stays out of `REGENERATED_PATHS`. Instead `APPEND_ONLY_PATHS`
  (`scripts/lib/stack-overlap.ts`, a code constant, never a config key) lets `mergeTreeVerdict`
  read a conflict as `clean` when every conflicted path is regenerated, or is an append-only path
  where both PRs add lines and delete none against their merge base (`git diff --numstat`). A PR
  that edits or removes an existing row, an unreadable merge base, or a binary diff stays a
  `conflict`. The textual conflict of two rows in the same gap resolves at merge time as a pure
  two-sided insertion (`merge-conflict-protocol.md` class 3), never a lost row. The `--open-prs`
  snapshot channel has no checkout to read diffs from and keeps treating the file as an overlap.
  Dispatch-time stacking (`pickStackParent`, `queue-dag.md` Step 3) has no merge-tree, so it reads
  the parent PR's diff instead: `pureAdditionFiles` (`git diff --numstat` of the PR ref against its
  merge base with the target branch) names the `APPEND_ONLY_PATHS` files the parent only adds rows
  to, and `pickStackParent` drops exactly those files from the overlap. An edited or removed row, a
  file absent at the merge base, an unreadable merge base or a binary diff keeps the file an
  overlap. The candidate's own side is not yet written; the PR-time `V-STACK-02` check verifies it.
