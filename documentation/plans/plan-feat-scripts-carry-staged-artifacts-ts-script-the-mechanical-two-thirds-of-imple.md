---
type: plan
summary: "Script the carry-staged-artifacts implementer step into a CLI+lib pair"
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-02
last_updated: 2026-09-02
---

# Plan — issue #715: `scripts/carry-staged-artifacts.ts`

## Objective

Script the mechanical two-thirds of `implementer.md` § Carry Staged Artifacts (manifest read,
shape guard, `target_kind` dispatch, frontmatter rewrite, `append_row` dedup for both
discriminator shapes) into `scripts/carry-staged-artifacts.ts` (CLI) +
`scripts/lib/carry-staged-artifacts.ts` (logic), following the `promote-review-artifact.ts` /
`companion-file-sync.ts` precedent (ADR-003). `implementer.md`'s prose shrinks to the
search-before-write judgment (irreducibly a live-repo/agent decision) plus one invocation line.
No new V-code, no new check file — this mechanizes an existing, already-enforced prose
procedure; `reviewer.md` §25 (`V-AUTO-02`) semantics are unchanged because the manifest schema
and carry contract do not change, only who executes the copy/rewrite/dedup steps.

## Touch-Paths

- `scripts/carry-staged-artifacts.ts` (new — CLI entrypoint, `--manifest <path> --repo-root <path>`)
- `scripts/lib/carry-staged-artifacts.ts` (new — pure logic: shape guard, dispatch, rewrite, dedup)
- `scripts/carry-staged-artifacts.test.ts` (new — CLI arg-parsing/exit-code tests)
- `scripts/lib/carry-staged-artifacts.test.ts` (new — unit tests on the pure functions)
- `src/agents/implementer.md` (§ Carry Staged Artifacts — shrink to judgment + invocation)
- `src/references/blackhole-state.md` (§ Consumers — record the script as the carry-step's
  implementation)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Task Breakdown (summary)

1. Failing unit tests for `scripts/lib/carry-staged-artifacts.ts` (red step).
2. Implement the lib to green.
3. Implement the CLI + its own tests to green.
4. Shrink `implementer.md` § Carry Staged Artifacts to judgment + one invocation line,
   within `CONTENT_GATE_BUDGETS`.
5. Update `blackhole-state.md` § Consumers with one bullet.
6. `bun run build`; commit source + regenerated dist together (`V-BUILD-01`).
7. Full targeted test run + `bun run verify`.

Full plan detail (Codebase Conventions, per-task acceptance criteria, stop conditions):
`.blackhole/plans/issue-715.md` (campaign working copy).

## References

- Retrospective item: `documentation/plans/plan-retrospective-v0.21.0-remediation.md` § R-10.
- Precedent: `scripts/promote-review-artifact.ts`, `scripts/lib/companion-file-sync.ts`.
- Manifest schema SSOT: `src/references/blackhole-state.md` § Staging (ADR-021 D1).
