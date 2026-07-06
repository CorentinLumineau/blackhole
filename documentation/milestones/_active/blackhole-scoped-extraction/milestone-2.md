---
type: plan
status: current
review_trigger: "on milestone completion"
created: 2026-07-06
last_updated: 2026-07-06
plan_base_commit: 015e7cc
related:
  - documentation/architecture/retrospective-blackhole.md
  - documentation/audits/architecture-coherence.md
initiative: blackhole-scoped-extraction
milestone: 2 of 3 (Tree-Shape SSOT)
track: quick
---

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
