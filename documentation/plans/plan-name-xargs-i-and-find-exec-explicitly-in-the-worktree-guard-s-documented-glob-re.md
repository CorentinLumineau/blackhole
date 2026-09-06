---
issue: 884
supersedes_adr: null
type: plan
summary: "Name xargs -I{} and find -exec explicitly in blackhole-protocol.md's worktree-removal-guard residual-limitations list"
status: current
review_trigger: "on worktree-removal-guard.js isLiteralPathArg change"
created: 2026-09-06
last_updated: 2026-09-06
---

# Plan - Issue #884

## Objective

Extend `src/references/blackhole-protocol.md` § Branch & Worktree Hygiene's "Recursive `rm` at a
worktree directory (#803)" bullet — specifically limitation clause **(1)** of its "Remaining
documented limitations" sentence — to name `xargs -I{}` and `find <worktree> -exec rm -rf {} \;`
explicitly, so a reader who greps the limitations list for their own shell idiom finds it there.

This is a **wording-only documentation fix**. `router-884` traced both shapes to the guard's
existing `isLiteralPathArg` predicate (`templates/hooks/pretooluse/utils/worktree-removal-guard.js`):
the `{}` placeholder both `xargs -I{}` and `find -exec … {} \;` leave behind is rejected as
non-literal, and on the `rm`-invocation evaluator that rejection is a deliberate fail-open
`continue` (as opposed to the `git worktree remove` path's fail-closed
`worktree-remove-unresolvable-path` refusal on the same non-literal-argument condition). This
asymmetry is intentional — refusing every `rm -rf "$dir"`/`cd "$dir" && rm -rf relative` in the
repo the way the rarer `git worktree remove "$var"` call is refused is not proportionate — and is
already stated by the very sentence this plan extends. No guard behavior changes here, and none
should: this plan documents the existing, correct, fail-open behavior, not a defect.

**Scope boundary — do not close the gap here.** The issue explicitly forecloses tightening
`isLiteralPathArg`'s treatment of `{}` as a follow-on: `{}` is legitimate in harmless contexts
(e.g. `rm -rf build/{dist,tmp}`), so narrowing it needs its own design pass and carries real
over-tightening risk. This plan documents the residual only.

## Touch-Paths

- `src/references/blackhole-protocol.md` plus all generated dist trees per
  `scripts/lib/build/targets.ts`

## Documentation Impact

None — this is a wording addition to an existing bullet in an existing `src/references/*.md`
reference file (compiled to `.claude/rules/`, `.cursor/rules/`, etc. via the standard build). No
`documentation/` companion doc, `ARCHITECTURE.md`, or `documentation/decisions/INDEX.md` row is
implicated: the change adds no new architectural constraint and alters no guard behavior, only
the guard's documented limitations list. `route.docs_impact: false` (router-884, ADR-004) agrees
with this assessment.

## Task Steps

1. **RED — confirm absence (baseline)**. Read against `origin/main`, never the working-tree
   mirror (18+ commits stale):
   ```
   git show origin/main:src/references/blackhole-protocol.md | grep -c "xargs"        # expect 0
   git show origin/main:src/references/blackhole-protocol.md | grep -c "find -exec"   # expect 0
   ```
   Capture the invariance baseline — both must read exactly `1` (verified this session):
   ```
   git show origin/main:src/references/blackhole-protocol.md | grep -o '\bmv\b' | wc -l            # 1
   git show origin/main:src/references/blackhole-protocol.md | grep -o 'find <worktree> -delete' | wc -l  # 1
   ```

2. **Edit** `src/references/blackhole-protocol.md`, `## Branch & Worktree Hygiene` section, the
   "Recursive `rm` at a worktree directory (#803)" bullet. The entire "Remaining documented
   limitations" sentence is a single unwrapped markdown line (confirmed this session: 5511
   characters, `origin/main` line 86) — the edit is an in-place substring replacement within
   that one line, touching **only** clause (1). Do not touch clause (2)
   (`find <worktree> -delete` / `mv <worktree> <elsewhere> && rm -rf <elsewhere>`), (3), or (4).

   Replace clause (1)'s text (reflowed here for readability; the committed file keeps its
   existing one-line convention):

   FROM:
   ```
   (1) a target spelled dynamically (`$VAR`, `${VAR}`, a glob, a command substitution), or a
   relative target following a `cd` whose OWN destination is spelled dynamically (including `cd
   -` and a bare `cd`, neither of which this guard tracks), cannot be resolved statically and is
   allowed knowingly — refusing any of these would attach a new refusal to every `rm -rf "$dir"`/
   `cd "$dir" && rm -rf relative` in the repo, so a recursive `rm` at a worktree path reached this
   way still bypasses these checks; spell the path (and any `cd` ahead of it) literally when the
   target is a worktree.
   ```

   TO:
   ```
   (1) a target spelled dynamically (`$VAR`, `${VAR}`, a glob, a command substitution, or the
   `{}` placeholder `xargs -I{} rm -rf {}` and `find <worktree> -exec rm -rf {} \;` substitute at
   runtime — `isLiteralPathArg` rejects `{}` as non-literal, and on the `rm` evaluator that
   rejection is a deliberate fail-open `continue`, not a refusal), or a relative target following
   a `cd` whose OWN destination is spelled dynamically (including `cd -` and a bare `cd`, neither
   of which this guard tracks), cannot be resolved statically and is allowed knowingly —
   refusing any of these would attach a new refusal to every `rm -rf "$dir"`/`cd "$dir" && rm -rf
   relative` in the repo, so a recursive `rm` at a worktree path reached this way — `xargs -I{}`
   and `find -exec` included — still bypasses these checks; spell the path (and any `cd` ahead of
   it) literally when the target is a worktree, and avoid piping a worktree path through
   `xargs`/`find -exec` for the same reason.
   ```

3. **Regenerate all committed mirrors**: `bun run build`. Verified this session via
   `git ls-tree -r origin/main --name-only | grep -i blackhole-protocol`, cross-checked against
   `scripts/lib/build/paths.ts`'s 8 `COMMITTED_TARGET_TREES` entries — the source
   (`src/references/blackhole-protocol.md`) plus **15** generated mirrors:
   - `.agents/build/rules/blackhole-protocol.md`
   - `.agents/build/skills/blackhole/references/blackhole-protocol.md`
   - `.claude/rules/blackhole-protocol.md`
   - `.claude/skills/blackhole/references/blackhole-protocol.md`
   - `.cursor/rules/blackhole-protocol.mdc`
   - `.cursor/skills/blackhole/references/blackhole-protocol.md`
   - `codex-skills/blackhole/references/blackhole-protocol.md`
   - `plugins/blackhole-agent-plugins/skills/blackhole/references/blackhole-protocol.md`
   - `plugins/blackhole-claude/rules/blackhole-protocol.md`
   - `plugins/blackhole-claude/skills/blackhole/references/blackhole-protocol.md`
   - `plugins/blackhole/rules/blackhole-protocol.md`
   - `plugins/blackhole/skills/blackhole/references/blackhole-protocol.md`
   - `references/blackhole-protocol.md`
   - `rules/blackhole-protocol.mdc`
   - `skills/blackhole/references/blackhole-protocol.md`

   **Count discrepancy vs. dispatch, flagged not silently resolved**: this plan independently
   verifies **15** generated mirrors (16 committed copies total including the `src/` source) via
   `git ls-tree`, not the 14 the orchestrator's dispatch message to `router-884` cited. Re-verify
   at implement time with the `git ls-tree` command above and match the post-`bun run build`
   `git diff --name-only` against **16** changed files (source + 15 mirrors).

4. **GREEN — confirm presence** in the source and all 15 mirrors (loop over the same 16 paths,
   asserting both `xargs` and `find -exec` are present in each — see the working plan copy at
   `.blackhole/plans/issue-884.md` for the exact loop).

5. **Invariance — prove clause (2) untouched**: re-run the two baseline greps from step 1
   against the edited `src/references/blackhole-protocol.md`; both must still read exactly `1`.

6. **Verify no content-gate/tree-registry regression**: `bun run verify` (or targeted
   `bun run scripts/checks/content-gates.check.ts` and
   `bun run scripts/checks/tree-registry.check.ts`).

## Sprint Contract

Definition of done is the grep-verified red (Task Step 1) → green (Task Step 4) → invariance
(Task Step 5) sequence, plus a clean `bun run verify` (Task Step 6). No test suite applies — this
is a prose edit to a markdown reference file with no executable behavior. `V-PLUGIN-01` is inert:
no `templates/hooks/**` path is touched.
