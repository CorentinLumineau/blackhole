---
type: plan
status: completed
completedAt: 2026-07-07
review_trigger: "on milestone completion"
created: 2026-07-06
last_updated: 2026-07-07
plan_base_commit: 015e7cc
pr: https://github.com/CorentinLumineau/blackhole/pull/90
related:
  - documentation/architecture/retrospective-blackhole.md
  - documentation/audits/architecture-coherence.md
initiative: blackhole-scoped-extraction
milestone: 2 of 3 (Tree-Shape SSOT)
track: quick
---

## Completion

- **status**: completed
- **completedAt**: 2026-07-07
- **pr**: https://github.com/CorentinLumineau/blackhole/pull/90

### Shipped

- `scripts/tree-shape.ts` (new) — `validatePluginTreeShape`, `geminiWorkspaceTreeErrors`, `distributionTreeErrors`, `codexTreeErrors`, all returning `string[]` (never throwing), zero imports from `build.ts`/`verify.ts`. Preserves the 5-agents-required vs. 0-agents-required inversion between the Gemini workspace tree and distribution bundle as two distinct functions.
- `scripts/tree-shape.test.ts` (new) — 21 unit tests, including every ported fixture case from the old `build.test.ts:149-202` (`assertDistributionTree`) and `verify.build.test.ts` (`evaluateDistributionBundle`) blocks.
- `scripts/build.ts` — `assertGeminiTree`/`assertDistributionTree`/`assertCodexTree` removed; the 3 call sites in `main()` now compute the relevant agent-file list and wrap `tree-shape.ts`'s error-returning functions with `if (errors.length) throw new Error(...)`, preserving exact throw-on-invalid behavior and call order (Gemini workspace assertion still runs before its detached manifest is written).
- `scripts/verify.ts` — local `validatePluginTreeShape` removed, replaced by the `tree-shape.ts` import; `checkGeminiBuild` now passes `RULES_LIST` explicitly (kept its own agent-count check and the real-manifest-path call, preserving the manifest-content validation that a naive `geminiWorkspaceTreeErrors` reuse would have silently dropped — see Deviation note below); `evaluateDistributionBundle` is now a one-line wrapper over `distributionTreeErrors`; `checkCodexSkillFile`/`checkCodexAgentFiles` fold in the safe, non-entangled subset of `codexTreeErrors` (5-agent-count, SKILL.md existence, non-empty references — the last one is new coverage, closing a gap that existed only in `build.ts`'s old assertion) via a documented substring-based partition.
- **Deviation from the plan's literal Task 4 wording** (documented per the Hard Choice Protocol): the per-file `instructions: |` presence check inside `checkCodexAgentFiles`'s loop was deliberately left as its own local implementation rather than folded into `codexTreeErrors`, because it's entangled with a `continue` short-circuit guarding the other per-file field checks (name/description/permissionMode/model/disallowedTools/instructions-length) — extracting it risked subtly changing control flow for a 2-line DRY gain. Also, `checkGeminiBuild` was NOT switched to `geminiWorkspaceTreeErrors` (which hardcodes `manifestPath: null` for build.ts's pre-manifest-write call site) — doing so would have silently dropped verify.ts's post-hoc manifest-content check (`$schema`/`name`/`version`/`description` presence), since verify.ts runs after the manifest exists and should validate it. Instead `checkGeminiBuild` calls the general `validatePluginTreeShape` directly with the real manifest path.
- Verified byte-for-byte identical output across the full compiled tree (`rules/`, `agents/`, `skills/`, `references/`, `.cursor/`, `.claude-plugin/`, `.codex-plugin/`, `codex-agents/`, `codex-skills/`, `.gemini-plugin/`, `plugins/blackhole/`, `codex-marketplace.json`, `SKILL.md`) pre/post change, re-confirmed after the review-fix round below. `bun test`: 180/180 pass. `bun run verify` (with `VERIFY_SKIP_BUILD=1` to avoid re-triggering a pre-existing, unrelated `.claude/` wipe bug — see Progress Log): 18/18 pass.

### Review-Fix Round (1 iteration)

3-agent swarm (quality, security, gates) found 3 MEDIUM findings (all pareto_score 48, no CRITICAL/HIGH), all fixed via TDD:
- **V-DRY-03**: `'instructions: |'` was duplicated across `tree-shape.ts`, `verify.ts` (×2), and `build.ts` with no shared constant — this milestone's own extraction added a 3rd independent copy. Fixed: exported `INSTRUCTIONS_MARKER` from `tree-shape.ts`, referenced at all 4 sites (`build.ts`'s YAML serializer, `tree-shape.ts`'s `codexTreeErrors`, `verify.ts`'s per-file check).
- **V-DRY-02**: `checkCodexAgentFiles`'s per-file loop re-implemented the same boolean check `codexTreeErrors` already computes. Fixed: exported a pure `hasInstructionsBlock(content)` predicate from `tree-shape.ts`, called from both sites — kept the `continue`-based control flow local to `verify.ts` (unchanged from the original deviation rationale).
- **V-KISS-01/V-PAT-04**: the substring-partition contract between `tree-shape.ts`'s error message wording and `verify.ts`'s `.includes(...)` filters had no test pinning it — a wording change would silently empty a filter with no test catching it. Fixed: added 3 dedicated coupling-contract tests in `tree-shape.test.ts` asserting the exact substrings (`'5 agent'`, `'SKILL.md'`, `'references'`) verify.ts's partition depends on.

Re-verified after fixes: `bun test` 180/180 pass (+5 from the fix), byte-for-byte identical compiled tree, `bun run verify` 18/18 pass.

### Progress Log

- **2026-07-07**: Milestone completed in one session, on the same branch as Milestone 1 (`blackhole/milestone-1-identity-ssot`) per user request to bundle M1-M3 into one PR (#90).
- **2026-07-07**: Discovered (not introduced by this milestone, but empirically triggered and confirmed while testing it): `scripts/build.ts`'s `cleanDir(path.join(root, '.claude'))` deletes the entire `.claude/` directory recursively, including tracked, non-build-output files (`.claude/initiatives/*.json`, `.claude/progress.md`). Running `bun run verify` (which internally shells out to `bun run build`/`bun run build --gemini` via 3 `spawnSync` calls — the exact hidden coupling channel flagged in the upstream retrospective, §1.3) triggers this and makes `V-BUILD-01` spuriously fail with "build left dirty output" for files that are session/tooling state, not compiled artifacts. Worked around for this session via `VERIFY_SKIP_BUILD=1` plus manual backup/restore. Recommended as a Milestone 3 follow-up or separate issue: scope `cleanDir` to only the subdirs it owns inside `.claude/` (`agents/`, `rules/`, `skills/`).

# Milestone 2 — Tree-Shape SSOT (tree-shape.ts)

## Objective

Extract `scripts/build.ts`'s three tree-shape assertion functions
(`assertGeminiTree`, `assertDistributionTree`, `assertCodexTree`) and
`scripts/verify.ts`'s partial helper (`validatePluginTreeShape`) into one new,
dependency-free module, `scripts/tree-shape.ts`, so `build.ts` (throw-on-invalid,
build time) and `verify.ts` (collect-and-report, post-hoc) both validate plugin
tree shape through a single shared implementation instead of two independently
duplicated/re-implemented checks. Eliminates the #1 DRY anti-pattern identified
in the upstream retrospective (~6-8% of combined `build.ts`+`verify.ts` LOC).
Pareto value 35% / effort 45%. This milestone is independently deployable from
Milestone 1 (Identity SSOT) — no shared touchpoints.

A hard constraint carries over verbatim from the upstream adversarial review:
`assertGeminiTree` (5 agents required) and `assertDistributionTree` (0 agents
required) have **inverted invariants** — this extraction must keep them as two
distinct, explicit code paths sharing only truly-common helper logic, never one
generalized "expected agent count" function. A structural-integrity critic
flagged exactly this kind of merge as the #1 danger of this extraction shape.

**Out of scope** (do not touch): the 3 hidden `spawnSync('bun run build')`
runtime-coupling channels in `scripts/verify.ts` (explicit upstream residual,
deferred); `checkCodexManifest`'s and `checkCodexAgentFiles`'s field-level
checks in `scripts/verify.ts` that go beyond `assertCodexTree`'s original
invariants (name/description/permissionMode/model-absence/disallowedTools/
instructions-length) — only the subset that genuinely overlaps with
`assertCodexTree` moves into the shared module; everything else stays exactly
where it is. Generated-file marker logic (F5, already resolved in commit
3ad5d5e) must not regress in either edited file.

## Task Breakdown

**Dependency order**: Task 1 → {Task 2, Task 3, Task 4} → Task 5.

### Task 1 — Create `scripts/tree-shape.ts` as a pure, dependency-free module

Design constraint that avoids a circular import: `tree-shape.ts` must import
**nothing** from `build.ts` or `verify.ts`. `RULES_LIST`, `AGENT_MD_FILES`, and
`AGENT_YAML_FILES` stay owned by `build.ts` exactly as today (per the F1
precedent — `verify.ts` already imports them from `build.ts`); `tree-shape.ts`'s
functions take the already-filtered file lists / rules list as parameters
instead of importing the constants themselves. This matters because `build.ts`
will need to import functions FROM `tree-shape.ts` in Task 3 — importing
`RULES_LIST` the other way round would create `build.ts` → `tree-shape.ts` →
`build.ts`.

Export exactly these functions, each returning `string[]` (empty = valid),
never throwing:

- `validatePluginTreeShape(treeRoot: string, manifestPath: string | null, labels: { treePrefix: string; manifest: string }, rulesList: string[]): string[]` — moved verbatim from `verify.ts:338-375`, with one change: `manifestPath` becomes nullable — when `null`, skip the manifest-existence/shape checks entirely (needed because the Gemini workspace tree's manifest is written *after* its shape assertion runs in `build.ts`; see Task 3).
- `geminiWorkspaceTreeErrors(destRoot: string, label: string, rulesList: string[], agentFiles: string[]): string[]` — replaces `assertGeminiTree`'s body. Checks `agentFiles.length === 5` (exact — the workspace-tree invariant) AND delegates rule/SKILL.md/references checks to `validatePluginTreeShape(destRoot, null, { treePrefix: label + '/', manifest: '' }, rulesList)`.
- `distributionTreeErrors(destRoot: string, manifestPath: string, rulesList: string[]): string[]` — replaces `assertDistributionTree`'s body. Delegates to `validatePluginTreeShape(destRoot, manifestPath, { treePrefix: '', manifest: 'plugin.json' }, rulesList)` AND additionally pushes `'distribution bundle must not contain agents/ (AC4)'` when `fs.existsSync(path.join(destRoot, 'agents'))`. This agents-dir check exists today only in `verify.ts`'s `evaluateDistributionBundle` — folding it into the shared function closes a silent gap without changing behavior: `compileGeminiTree` is always called with `{ includeAgents: false }` for the distribution root, so the added check is inert in practice and only strengthens parity with what `verify.ts` already enforced.
- `codexTreeErrors(rootDir: string, agentFiles: string[]): string[]` — replaces `assertCodexTree`'s body: exact `agentFiles.length === 5`, each file contains `'instructions: |'`, `codex-skills/blackhole/SKILL.md` exists, `codex-skills/blackhole/references/` exists and is non-empty.

Do NOT generalize `geminiWorkspaceTreeErrors` and `distributionTreeErrors` into
one parameterized "expected agent count" function — see the inversion warning
in the Objective above.

**Acceptance criteria**: `scripts/tree-shape.ts` exists, has zero imports from
`build.ts`/`verify.ts`, exports the four functions above, all four return
`string[]` and never throw.

### Task 2 — Write `scripts/tree-shape.test.ts`

Port and extend unit tests: `validatePluginTreeShape` (valid tree → `[]`;
missing rule file → error mentioning the rule name; missing SKILL.md → error;
empty `references/` → error; `manifestPath: null` → manifest checks skipped
entirely; missing/invalid manifest → error), `geminiWorkspaceTreeErrors` (4
agents → agent-count error; 5 agents + missing rule → both errors present),
`distributionTreeErrors` (existing `agents/` dir present → AC4 error; port the
existing fixtures from `scripts/build.test.ts:140-193`
(`describe('assertDistributionTree', ...)`) and
`scripts/verify.build.test.ts:101-151` (`describe('evaluateDistributionBundle', ...)`)
so no coverage is lost), `codexTreeErrors` (4 yaml files → count error; yaml
file missing `instructions: |` → error; missing SKILL.md; empty references
dir).

**Acceptance criteria**: `bun test scripts/tree-shape.test.ts` passes; every
fixture case from the two ported describe blocks above has an equivalent case
here; those two blocks are then removed from their old files (Tasks 3/4)
only once this port is confirmed passing.

**Depends on**: Task 1 (function signatures must exist first).

### Task 3 — Edit `scripts/build.ts`

Remove the local `assertGeminiTree`, `assertDistributionTree`, `assertCodexTree`
implementations (current lines 329-344, 348-364, 387-409). Import
`geminiWorkspaceTreeErrors`, `distributionTreeErrors`, `codexTreeErrors` from
`./tree-shape.ts`. At each of the 3 call sites (current lines 533, 548, 580),
compute the errors array and wrap: `if (errors.length) throw new
Error(errors.join('; '));` — preserving the existing throw-on-invalid behavior
exactly, same call order, so the Gemini workspace call still happens *before*
`writeGeminiManifest` runs (per Task 1's `manifestPath: null` design). Remove
`scripts/build.test.ts`'s `describe('assertDistributionTree', ...)` block
(lines 140-193) once Task 2's port is confirmed passing. Do not touch the
generated-file marker logic (F5, already resolved) anywhere in this file —
this task's diff must stay confined to the three assertion call sites, their
imports, and the corresponding test-file cleanup.

**Acceptance criteria**: `bun run build --all` produces byte-identical output
to `main` (no tree-shape or generated-marker diff); `assertGeminiTree` and
`assertCodexTree` no longer exist as separate implementations in `build.ts`;
`bun test scripts/build.test.ts` passes.

**Depends on**: Task 1, Task 2.

### Task 4 — Edit `scripts/verify.ts`

Remove the local `validatePluginTreeShape` (current lines 338-375) and the
duplicated inline agent-count/rule-shape logic inside `checkGeminiBuild` (lines
390-429) and `evaluateDistributionBundle` (lines 433-444). Replace with calls
into `geminiWorkspaceTreeErrors`/`distributionTreeErrors` from
`./tree-shape.ts`, keeping the existing `string[]`-accumulation / `CheckResult`
(`fail('V-GEMINI-01', ...)`, `pass(...)`) reporting style untouched — only the
shape-computation internals route through the shared module. For
`checkCodexBuild`'s split (`checkCodexBuildExec`/`checkCodexManifest`/
`checkCodexSkillFile`/`checkCodexAgentFiles`, per F2), fold `codexTreeErrors`'
overlapping subset (5-yaml-count, `instructions: |` presence, SKILL.md
existence, non-empty references) into `checkCodexAgentFiles`/
`checkCodexSkillFile` in place of their equivalent inline checks, while
preserving every field-level check with no `assertCodexTree` counterpart
unmoved (see Out of scope above). Add the new `./tree-shape.ts` import
alongside the existing `./build.ts` constants import (`AGENTS_BUILD_ROOT`,
`AGENTS_BUILD_AGENT_DIR`, `DISTRIBUTION_ROOT`, `AGENT_MD_FILES`,
`AGENT_YAML_FILES`, `RULES_LIST`) — do not remove that import (F1 precedent
stays intact). Remove `scripts/verify.build.test.ts`'s shape-duplication cases
in `describe('evaluateDistributionBundle', ...)` (lines 101-151) once Task 2's
port covers them. Do not touch the generated-file marker checks (F5) anywhere
in this file.

**Acceptance criteria**: `bun run verify` reports the same
V-GEMINI-01/V-GEMINI-02/V-CODEX-01..04 pass/fail outcomes as on `main` for an
unmodified tree (all pass); `bun test scripts/verify.build.test.ts` passes;
`validatePluginTreeShape` no longer exists as a separate implementation in
`verify.ts`.

**Depends on**: Task 1.

### Task 5 — Regression verification (full build + verify + test suite)

Run `bun run build && bun run build --all && bun run verify` and diff the
compiled tree (rules/, agents/, skills/, `.agents/build/`,
`plugins/blackhole/`, codex-agents/, codex-skills/) against a pre-change
snapshot to confirm byte-for-byte identical output — this is a pure refactor,
no behavior change is expected anywhere in this milestone. Then run the full
test suite.

**Acceptance criteria**: zero diff between pre-change and post-change compiled
output; `bun run build --all` exits 0; `bun run verify` exits 0; `bun test`
exits 0 (full suite, including the new `tree-shape.test.ts`).

**Depends on**: Task 3, Task 4.

## References

- `documentation/architecture/retrospective-blackhole.md` §3.4 Scoped
  Extraction, §1.6 Anti-Pattern #2, §5 DRY Analysis
- `documentation/audits/architecture-coherence.md`
- F1 precedent (commit 3ad5d5e): `RULES_LIST` cross-file sharing via plain
  named export/import — same convention applied to `tree-shape.ts`'s
  parameterized design in Task 1
- F2 precedent (commit 3ad5d5e): `checkCodexBuild` split into 4 named
  sub-checks — same "small, named, single-purpose function" granularity
  applied here
