---
type: plan
status: current
created: 2026-09-01
last_updated: 2026-09-01
review_trigger: "on ADR acceptance"
related:
  - documentation/architecture/retrospective-blackhole.md
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
  - documentation/decisions/ADR-021-durable-artifact-staging.md
  - documentation/audits/build-tree-install-resolution.md
---

# Plan — v0.21.0 Retrospective Remediation

Work breakdown for the findings in `documentation/architecture/retrospective-blackhole.md`
(v0.21.0, `9274fbc`). Every item below is filed as a GitHub issue, child of the remediation epic;
issue numbers are in the table (epic: #703). Items are sized for one reviewable PR each; anything that needs
a decision goes through the campaign's design track (an ADR) before code.

Read this file top to bottom before picking an item: § Ground rules carries constraints that
apply to every PR, § Dependency graph says what must land first, and each item's section holds
the evidence, acceptance criteria, and touch paths a planner needs.

## Ground rules (apply to every item)

1. **ADR-007's rejections remain binding**: no generation-in-place of hand-authored files, no
   single-source derivation for both sides of a drift check, no central check-registry file, no
   build cache. Every new check pairs a declared side (`scripts/lib/build/facts.ts` § facts) with
   an independent scan side (`V-GROUND-01` / `V-VOCAB-01` shape).
2. **New checks go in a new `scripts/checks/<domain>.check.ts`** with a `runChecks()` export;
   `verify.ts` auto-discovers it. Add the V-code row to `src/references/blackhole-vcodes.md`
   with a `Primary enforcement site` column value that `V-CITE-01` can resolve. Until R-01 lands,
   bump `EXPECTED_CHECK_COUNT` in `facts.ts` and `VCODE_TABLE_ROW_COUNT` for every new row.
3. **Edit `src/` only, then `bun run build`**, and commit the regenerated trees in the same PR
   (`V-BUILD-01`). Expect ~8 mirrored files per `src/references` file touched.
4. **Content-gate budgets are not to be raised** to make a PR pass (`facts.ts` § content-gate
   budgets comment). If a target is at ceiling, extract; R-02 and R-15 exist for this.
5. **Tests first** (`V-TEST-01/02`): every check ships with a `scripts/verify.<domain>.test.ts`
   using the fixture helpers in `scripts/lib/test-fixtures.ts`; every script with a
   `scripts/<name>.test.ts`.
6. **Docs in the same PR**: `documentation/decisions/INDEX.md` for ADRs, `documentation/INDEX.md`
   for any new doc, and the affected `src/references/*.md` prose.
7. **Baseline evidence to reproduce, not copy**: numbers in the retrospective were measured at
   `9274fbc`; re-derive any number an AC depends on at the PR's base commit.

## Dependency graph

```
Wave 0 (independent, land in any order)
  R-01  R-02  R-03  R-04  R-05  R-06  R-07  R-08  R-09  R-20  R-21
Wave 1 (prose → script)
  R-10 ─┬─> R-12b (V-PROSE-01 check)
  R-11  │
  R-12  │
Wave 2 (seams — need a design-track ADR first)
  R-13a (ADR-028 + generic {{INCLUDE}} primitive)
     ├─> R-13b (reviewer migration)      needs R-06
     └─> R-14  (implementer gates)       needs R-10
  R-02 + R-13b + R-14 ──> R-15 (content gate v3)
Wave 3 (config, build, decisions)
  R-04 ──> R-16 (gate-resolution SSOT)
  R-03 ──> R-17 (named flags + V-TREE-01) ──> R-18 (tree-registry ADR)
  R-07 ──> R-19 (worker-schemas relocation)
```

`Blocked by` in each issue body mirrors this graph. Wave 0 has 11 items that are safe to
parallelise (2–4 per batch, non-overlapping touch paths — `queue-dag.md` wave rules).

## Items

| Id | Issue | Title | Priority (G×(11−E)) | Size | Blocked by |
|---|---|---|---:|---|---|
| R-01 | #704 | Retire `EXPECTED_CHECK_COUNT` (derived rollup) and its string-literal consumer | 50 | xs | — |
| R-02 | #705 | Add `orchestrator-runtime/dispatch/delegation.md` to `CONTENT_GATE_BUDGETS` | 60 | xs | — |
| R-03 | #706 | Fix stale build-tree table in `documentation/architecture.md` and "five agents" in `ARCHITECTURE.md` | 60 | xs | — |
| R-04 | #707 | `V-CONFIG-02`: parent-key coverage for nested config blocks (`router_confidence_thresholds`) | 40 | xs | — |
| R-05 | #708 | `V-SHAPE-01` route field-set parity across router validator, schema example, queue-dag, status type | 64 | s | — |
| R-06 | #709 | Per-dispatch-mode reviewer prompt requirements in `review-core.md` (ISP) | 50 | xs | — |
| R-07 | #710 | `ADR_WATCH_ITEMS` fact + `V-WATCH-01` advisory check | 54 | s | — |
| R-08 | #711 | Declare `ADR_SHAPES` and check ADR headings against either shape | 40 | s | — |
| R-09 | #712 | Record #408's reversal of ADR-007 R3′ as an amendment; supersession rule with two detection legs (`V-ADR-06`) | 54 | s | — |
| R-10 | #715 | `scripts/carry-staged-artifacts.ts` — script the mechanical two-thirds of Carry Staged Artifacts | 49 | m | — |
| R-11 | #716 | Plan-quality-gate CLI invoked by planner step 8; retire duplicated prose checks | 40 | s | — |
| R-12 | #717 | `scripts/decision-log-append.ts` (bumps `last_updated`) + silent-log doc-health signal | 40 | s | — |
| R-12b | #718 | Mechanical-vs-judgment rule sentence + `V-PROSE-01` WARN check | 45 | s | R-10 |
| R-13a | #719 | ADR-028 (design track): audit-module seam + generic `{{INCLUDE:<dir>/*}}` build primitive | 45 | m | — |
| R-13b | #720 | Migrate `reviewer.md`'s 29 audits to `src/references/audits/`; `V-AUDIT-01`; named-section citations | 45 | m | R-13a, R-06 |
| R-14 | #721 | Migrate implementer gates to `src/references/gates/`; fix heading nesting | 42 | m | R-13a, R-10 |
| R-15 | #722 | Content gate v3: glob-class budgets, grandfather allowlist with sunset ADR, `V-CONTENTGATE-03` | 42 | m | R-02, R-13b, R-14 |
| R-16 | #723 | Config-gate `resolution:` SSOT line per block + `V-GATE-02` scan | 48 | s | R-04 |
| R-17 | #724 | Named-flags build plumbing (`{gemini, codex, agentPlugins}`) + `V-TREE-01` | 40 | s | R-03 |
| R-18 | #725 | ADR (design track): resolve the 3 "Unknown" build trees from the #328 audit | 42 | s | R-17 |
| R-19 | #726 | Relocate `worker-schemas.md`'s orchestrator-side sections (~112 LOC) to `orchestrator-runtime.md` | 36 | s | R-07 |
| R-20 | #713 | Harness integration test for the `skills.sh` branch of `model-routing.md` | 32 | s | — |
| R-21 | #714 | Bug: `validate-file-changes.js` #510/#512 tests fail on macOS (`os.tmpdir()` under `/private/var`) | 40 | xs | — |

### R-01 — Retire `EXPECTED_CHECK_COUNT`

**Evidence.** `scripts/lib/build/facts.ts` `EXPECTED_CHECK_COUNT` is a derived rollup (the sum
`verify.ts` already computes as `results.length`), WARN-only, bumped in ~30 of the 42 commits
that touched `facts.ts` since v0.16.0 — the "touched on every new invariant" coupling ADR-007
rejected for a check registry, re-emerged as an integer. Second consumer by string literal:
`scripts/lib/plan-touch-path-ssot-pairs.ts` `TOUCH_PATH_SSOT_PAIRS[1]` and
`scripts/verify.plan-quality-gate.test.ts:257,275`.
**AC.** Constant, `warnOnCheckCountMismatch`, the `TOUCH_PATH_SSOT_PAIRS[1]` row and its test
assertions removed; `grep -rn EXPECTED_CHECK_COUNT scripts src documentation` returns only the
retrospective; `VCODE_TABLE_ROW_COUNT` untouched; `bun run verify` and `bun test` green; the
`facts.ts` header comment and `V-GROUND-01` prose no longer mention the counter.
**Touch.** `scripts/lib/build/facts.ts`, `scripts/verify.ts`, `scripts/verify.runner.test.ts`,
`scripts/lib/plan-touch-path-ssot-pairs.ts`, `scripts/verify.plan-quality-gate.test.ts`,
`src/references/*.md` prose citing it.

### R-02 — Budget the three orchestrator split-off files

**Evidence.** `facts.ts` `CONTENT_GATE_BUDGETS` has no key for `orchestrator-dispatch.md` (333
LOC, 11 concerns), `orchestrator-runtime.md` (202), `orchestrator-delegation.md` (177) — the
files #408 created from `orchestrator.md`, which itself sits at 180/185.
**AC.** Three rows seeded at measured × 1.2 per the documented policy, with the measurement
table in the `facts.ts` comment extended; `V-CONTENTGATE-01/02` pass; no budget of an existing
row changed.
**Touch.** `scripts/lib/build/facts.ts`, `scripts/verify.content-gates.test.ts`.

### R-03 — Fix the stale architecture maps

**Evidence.** `documentation/architecture.md` § Committed target trees still maps `.claude/` +
`.claude-plugin/` as the Claude marketplace path (pre-ADR-009) and has no row for
`plugins/blackhole-claude/`; flagged stale by `build-tree-install-resolution.md` at v0.16.0,
unchanged 227 commits later. `ARCHITECTURE.md` §3.2 says "Five markdown-defined agents";
`AGENT_NAMES` has eight.
**AC.** One row per tracked tree matching `scripts/lib/build/paths.ts` and README § Installation
Paths; `.claude/` row states "maintainer-local, not an install path (ADR-009)"; §3.2 lists the
eight agents by name; `V-LINK-01` passes.
**Touch.** `documentation/architecture.md`, `ARCHITECTURE.md`.

### R-04 — Nested config-key registration

**Evidence.** `bun run verify` fails `V-CONFIG-02` on `router_confidence_thresholds.split` … `.ui`
when `.blackhole/config.json` is present: `config-registration.check.ts` flattens nested objects
to leaf keys, while `config-template.md:47` documents the block as one row.
**AC.** Either the check treats a documented parent key whose row names its sub-keys as covering
them, or the template gains one row per leaf — pick one and document it in the check header;
`V-CONFIG-02` passes with `fixtures/config.example.json` and with the live block; test covers a
nested-but-undocumented leaf still failing.
**Touch.** `scripts/checks/config-registration.check.ts`, `scripts/verify.config-registration.test.ts`,
`src/references/config-template.md`.

### R-05 — `V-SHAPE-01` route field-set parity

**Evidence.** `scripts/lib/worker-json/validators/router.ts:21-51` requires `needs_brainstorm`,
`needs_analysis`, `docs_impact`, `ui` and `confidence.{docs,brainstorm,analysis,ui}`;
`src/references/worker-schemas.md` § Router example JSON omits four of them;
`scripts/lib/campaign-status/types.ts` `Route` omits `ui`, `needs_brainstorm`, `needs_analysis`,
`docs_impact` while its comment says it "must not rename or add fields". Nothing compares them
(`inline-schema-drift.check.ts` excludes `worker-schemas.md`; `schema.check.ts` covers fixtures
only). Same defect class as ADR-012 F3b.
**AC.** New `scripts/checks/route-shape.check.ts`, staged (critic: prose sources need an
example-vs-schema disambiguation before they can be a declaration side). **Stage 1 (required
for this issue):** `requireField` keys in `router.ts` vs `campaign-status/types.ts` `Route` keys,
the latter compared against a declared `omits:` allowlist in its header comment (parsed by the
check) so intentional narrowing passes and undeclared drift fails. **Stage 2 (same issue if
cheap, else a follow-up filed from this one):** the Router example JSON in `worker-schemas.md`
and the `route` table rows in `queue-dag.md`, each marked as exhaustive by a one-line
`<!-- shape: exhaustive -->` comment the check requires before trusting it. Symmetric difference
named per pair; the four missing example fields and the `types.ts` allowlist added; V-code row
`V-SHAPE-01` (WARN) with test fixtures for each drift direction.
**Touch.** `scripts/checks/route-shape.check.ts` (new), `scripts/verify.route-shape.test.ts`
(new), `src/references/worker-schemas.md`, `src/references/queue-dag.md`,
`scripts/lib/campaign-status/types.ts`, `src/references/blackhole-vcodes.md`, `facts.ts` counters.

### R-06 — Per-mode reviewer prompt requirements

**Evidence.** `src/references/review-core.md` § Reviewer prompt requirements mandates "Full
V-code audit checklist" for every delegation; `reviewer.md` §24 (verification mode) says "do not
run §§1-23's full checklist". Same for recheck mode (§13).
**AC.** The requirements list gains a per-mode table (full / recheck / verification /
security-mode) stating which inputs each mode receives; §13/§24 cite it instead of contradicting
it; `V-GATECONTENT-01` and `V-CITE-01` pass. Prose only — no agent identity change (issue #439's
"same agent identity" decision stands).
**Touch.** `src/references/review-core.md`, `src/agents/reviewer.md` §13/§24.

### R-07 — `ADR_WATCH_ITEMS` + `V-WATCH-01`

**Evidence.** ADR-007 § Rejected alternatives set "revisit at >700 LOC or any role contract >80
LOC" for `worker-schemas.md`; it is 940 LOC with 175/178-LOC role sections and was never
revisited — the budget was raised instead (#473, #492). ADR-021 D2 says a further Stop-condition
extension "should split it rather than extend it again".
**AC.** `facts.ts` exports `ADR_WATCH_ITEMS: {adr, file, metric: 'file_loc'|'section_loc'|
'section_count', threshold, note}[]`; new `scripts/checks/adr-watch.check.ts` measures each row
and emits `V-WATCH-01` (WARN, `ok: true`, same shape as `V-CONTENTGATE-02`) naming the ADR and
value; first rows: ADR-007 worker-schemas (700 / 80), ADR-021 Stop-condition; V-code row; test
with a fixture above and below threshold.
**Touch.** `scripts/lib/build/facts.ts`, `scripts/checks/adr-watch.check.ts` (new),
`scripts/verify.adr-watch.test.ts` (new), `src/references/blackhole-vcodes.md`.

### R-08 — `ADR_SHAPES` and heading check

**Evidence.** `src/references/adr-template.md` declares 5 headings and `planner.md:314` says
"`##` missing = blocked", but ADR-017/018/019/020/021(staging)/025 ship the 8-heading design-note
shape that `design-track.check.ts` enforces on `plan-template.md`; `adr-status.check.ts` checks
status only. Three shapes coexist.
**AC.** `facts.ts` declares `ADR_SHAPES = { classic: [...5], designTrack: [...8] }`
(`design-track.check.ts` imports the latter instead of its local list); `adr-status.check.ts`
gains `V-ADR-06`… — use the next free `V-ADR-` number — asserting every tracked ADR matches one
shape; `adr-template.md` documents both shapes and when each applies; planner's Design Track cites
the fact by name; test with one ADR of each shape and one malformed.
**Touch.** `scripts/lib/build/facts.ts`, `scripts/checks/adr-status.check.ts`,
`scripts/checks/design-track.check.ts`, `src/references/adr-template.md`, `src/agents/planner.md`.

### R-09 — Supersession through the decision path

**Evidence.** PR #408 (`.blackhole/plans/issue-366.md`, gitignored) split `orchestrator.md`,
stating it "intentionally supersedes ADR-007 R3′" and instructing "do not amend ADR-007"; no ADR
or INDEX row records it. Detection cannot rely on self-disclosure alone.
**AC.** (1) ADR-007 gains a dated `## Post-acceptance amendments` entry for R3′ (split accepted
on the condition that split-off files are budgeted — R-02) and `documentation/decisions/INDEX.md`
summary updated. (2) `plan-template.md` frontmatter gains optional `supersedes_adr: [ADR-NNN]`;
`implementer.md` Carry step stages a one-line amendment when set. (3) New check `V-ADR-0N`
(WARN) with two legs: a plan/PR that declares `supersedes_adr` without a staged amendment, and a
diff under `src/` or `documentation/` (excluding `decisions/`) containing
`supersedes|reverses|contrary to|do not amend .* ADR-\d+` without one. Tests for both legs.
(4) Because #408 never declared anything and plan files are gitignored, a third leg runs where
the plans live: the `docs` kaizen hunt kind gains a band that scans `.blackhole/plans/*.md` for
the same phrases near an `ADR-NNN` and files a WARN finding when `documentation/decisions/INDEX.md`
shows no matching status/summary change — `hunt/docs.md` gets the band, `hunter.md` is untouched.
**Touch.** `documentation/decisions/ADR-007-*.md`, `documentation/decisions/INDEX.md`,
`src/references/plan-template.md`, `src/agents/implementer.md`, new check + test,
`src/references/blackhole-vcodes.md`.

### R-10 — `scripts/carry-staged-artifacts.ts`

**Evidence.** `src/agents/implementer.md` § Carry Staged Artifacts (81 LOC) executes a
`target_kind` dispatch, a 9-row frontmatter rewrite table and an `append_row` idempotency
discriminator as prose-driven Bash heredocs, while its siblings in the same file are
`bun run scripts/promote-review-artifact.ts` and `bun run scripts/lib/companion-file-sync.ts`.
ADR-003 precedent.
**AC.** Script takes `--manifest <path> --repo-root <path>`; implements copy / frontmatter
rewrite / `append_row` dedup (both discriminator shapes: `path` column and `(ADR-NNN)` /
`(analyze: issue #N)` suffix) idempotently; prints the carried paths as JSON; the prose section
shrinks to the search-before-write judgment and one invocation line; `staging-schema.check.ts`
fixtures reused for tests; `reviewer.md` §25 unchanged in semantics.
**Touch.** `scripts/carry-staged-artifacts.ts` (new), `scripts/lib/carry-staged-artifacts.ts`
(new), tests, `src/agents/implementer.md`, `src/references/blackhole-state.md` § Consumers.

### R-11 — Plan-quality-gate CLI at plan time

**Evidence.** `scripts/checks/plan-quality-gate.check.ts` exports `findMissingCriticalFiles` /
vague-mitigation scans that its own `runChecks()` does not call and `planner.md` step 8 re-implements
in prose; only the fixture test calls them.
**AC.** `scripts/plan-quality-gate.ts --plan-file <path>` (same argv shape as
`companion-file-sync.ts`) prints `{ac_mapping, critical_files_exist, mitigation_concrete}`;
planner step 8 invokes it and copies the result into the return JSON; prose duplicate removed;
`plan-quality-gate.check.ts` header updated.
**Touch.** `scripts/plan-quality-gate.ts` (new), `scripts/checks/plan-quality-gate.check.ts`,
`src/agents/planner.md`, `src/references/worker-schemas.md` § Plan quality gate checks.

### R-12 — `scripts/decision-log-append.ts`

**Evidence.** `documentation/reference/decision-log.md` has 4 rows from one append (2026-07-29)
and `last_updated: 2026-07-20`; `orchestrator.md` § Decision Record Append is prose and never
bumps the frontmatter; nothing notices a silent log.
**AC.** Script appends rows from a `decision_records[]` JSON argument, dedups by `(pr, kind)`,
bumps `last_updated`; orchestrator section becomes one invocation; `doc-health-signal.ts` gains an
advisory `decision_log_silent_prs` count (merged PRs since last append) surfaced in
`doc-health.json`.
**Touch.** `scripts/decision-log-append.ts` (new) + test, `src/agents/orchestrator.md`,
`scripts/doc-health-signal.ts`, `src/references/doc-governance.md`.

### R-12b — Mechanical-vs-judgment rule + `V-PROSE-01`

**AC.** One sentence in `blackhole-protocol.md` § Orchestrator discipline: "a step whose output
is a pure function of files or JSON is a `bun run scripts/<name>.ts` invocation; prose holds only
judgment (ADR-003)". New check `V-PROSE-01` (WARN): a fenced block in `src/agents/*.md` that
writes a heredoc (`cat <<`) under `documentation/` or `.blackhole/staged/` is flagged with
file:line. Blocked by R-10 so the check reports zero on landing.
**Touch.** `src/references/blackhole-protocol.md`, new check + test, `blackhole-vcodes.md`.

### R-13a — ADR-028 + generic `{{INCLUDE}}` primitive (design track)

**Evidence.** `scripts/lib/build/content.ts` `processFile` is strictly 1 source → 1 output and
already performs marker substitution (`{{AGENT_DIR}}`, `{{VCODES_PATH}}`, `{{#host}}` blocks).
`reviewer.md` is 778 LOC / 29 audits and grows by one section per governance ADR; `hunter.md`
(136 LOC) proves the module-per-concern seam in this repo.
**Decision to record (ADR-028).** A generic `{{INCLUDE:<dir>/*}}` marker expanded in
`processFile` for any agent on every target, in source-directory order, so the compiled file is
still one file per agent; module directories declared in a `BUILD_INPUT_ONLY_DIRS` fact and
two-sidedly checked absent from every tree (or mirrored like `hunt/` — the ADR must pick one and
say why); no mode-variant agent files (collides with `AGENT_NAMES` tree-shape counts and #439);
citations by named section; append-only module numbering. Alternatives to evaluate and reject
with evidence: runtime loading like `hunt/<kind>.md` (ADR-007 R3′ context-fetch cost applies),
per-target special-casing (breaks the uniform compile path), keeping the LOC gate. The ADR must
**rule explicitly** on the provenance question the critics raised: ADR-007 rejected
generation-in-place on the premise "every file is wholly generated or wholly authored"; under
this seam every `src/` file stays wholly authored and every compiled file wholly generated, but
the mapping becomes many-authored → one-generated for the first time. Do not assert this is
in-bounds in the ADR body — put it through the Design Track's blind-critic panel and
`design-aggregate.ts` verdict, and record the outcome.
**AC.** ADR-028 accepted and indexed; `processFile` supports the marker with tests on every
target; a fixture agent with two modules compiles to one file on all 9 trees; `V-BUILD-01`,
`V-GROUND-01`, tree-shape checks pass; no agent uses it yet.
**Touch.** `documentation/decisions/ADR-028-*.md`, `documentation/decisions/INDEX.md`,
`scripts/lib/build/content.ts`, `scripts/lib/build/facts.ts`, `scripts/build.test.ts`,
`documentation/architecture.md`.

### R-13b — Reviewer migration + `V-AUDIT-01`

**AC.** 29 files under `src/references/audits/NN-<slug>.md` with `vcodes:` frontmatter, content
moved verbatim; `reviewer.md` shell ≤ 200 LOC (Iron Law, dispatch modes, output format, marker);
compiled `reviewer.md` byte-equivalent to today's minus heading renames; all 62 `reviewer.md §N`
citations in `blackhole-vcodes.md`, the 80+ in-body `§ N` references, and the absolute
line-number citations elsewhere (`router.md:100` → `reviewer.md:133`, `review-core.md:270` →
`reviewer.md:51`, `config-template.md:50` → `reviewer.md:130`) rewritten to `§ <Name>`;
`V-CITE-01` passes; new `V-AUDIT-01` check: every V-code whose primary site is the
reviewer appears in exactly one module's `vcodes:` and every listed code exists in the table;
`CONTENT_GATE_BUDGETS['src/agents/reviewer.md']` replaced by a module-count declaration
(`REVIEWER_AUDIT_MODULE_COUNT`, two-sided against the directory scan).
**Touch.** `src/agents/reviewer.md`, `src/references/audits/**` (new), `blackhole-vcodes.md`,
`review-core.md`, new check + test, `facts.ts`.

### R-14 — Implementer gates migration

**AC.** Gates (Reuse Check, Plan Drift, Scout, Bugfix, Conflict Resolution, Execution Mode,
Sensitive-Filename, Git Targeting, Verification Evidence, Visual Evidence, Context-Anxiety, Carry
residual, Promote, Companion-file Sync) become `src/references/gates/NN-<slug>.md`;
`implementer.md` shell ≤ 250 LOC with persona, TDD loop, `{{INCLUDE:gates/*}}`, return format;
the heading-nesting defect (three `###` under `## Companion-file Sync`) disappears; compiled
output semantically unchanged; citations to `implementer.md § …` fixed; budget row replaced by a
module count.
**Touch.** `src/agents/implementer.md`, `src/references/gates/**` (new), `facts.ts`, citations.

### R-15 — Content gate v3

**AC.** `CONTENT_GATE_BUDGETS` keyed by glob class (`src/agents/*.md`, `src/references/*.md`,
`src/references/hunt/*.md`, `scripts/checks/*.check.ts`, `scripts/lib/build/*.ts`) with one
ceiling per class; `CONTENT_GATE_GRANDFATHERED: {file, ceiling, sunset_adr}[]` for files above
class ceiling at landing; `V-CONTENTGATE-03` (WARN) fires when any budget or grandfather ceiling
is raised without an INDEX.md row citing the ADR; per-file `boundaryPattern` where `###` is the
unit. Blocked by R-02/R-13b/R-14 so the grandfather list is short.
**Touch.** `facts.ts`, `scripts/checks/content-gates.check.ts`, tests, `blackhole-vcodes.md`.

### R-16 — Config-gate resolution SSOT

**Evidence.** The clause "absent block, absent field, or explicit `false` — SSOT:
`config-template.md`'s `docs_governance.enabled` row" is copied at 8 sites (`SKILL.md:59`,
`implementer.md:284`, `reviewer.md:187/385/566/656`, `orchestrator.md:137`,
`orchestrator-delegation.md:81`, `doc-governance.md:11`); `reviewer.md:566` already drifted.
**AC.** Each nested block row in `config-template.md` gains a `resolution:` sentence; consumption
sites cite `config-template.md § <block> resolution` plus their local effect only; new
`V-GATE-02` (WARN) check: the resolution phrase (regex on "absent block, absent field") outside
`config-template.md` fails naming the site; zero hits at landing.
**Touch.** `src/references/config-template.md`, the 8 sites, new check + test.

### R-17 — Named-flags plumbing + `V-TREE-01`

**Evidence.** `scripts/lib/build/clean.ts:81` `cleanBuildDirectories(buildGemini, buildCodex,
buildAgentPlugins)`; ADR-025 recorded 3 BREAKING signature rows and 14 touched files for one
target.
**AC.** `determineBuildTargets()` returns `{ gemini, codex, agentPlugins }` and
`cleanBuildDirectories(flags)`; `build.ts` call site updated; per-target `tree-shape.ts`
validators untouched (ADR-009); new `V-TREE-01` (WARN): tree list from `paths.ts` vs
`documentation/architecture.md` § Committed target trees rows vs README § Installation Paths
stanzas, symmetric difference named.
**Touch.** `scripts/lib/build/clean.ts`, `scripts/build.ts`, `scripts/build.test.ts`, new check +
test, `blackhole-vcodes.md`.

### R-18 — Tree-registry ADR (design track)

**Evidence.** `documentation/audits/build-tree-install-resolution.md` § Classification summary
leaves 3 trees "Unknown" (root `.claude-plugin/plugin.json` twin, `codex-agents/`,
`.gemini-plugin/plugin.json` twin) and README § Antigravity still says `bun run build` before
`ln -s`; issue #328's follow-up ADR never happened.
**AC.** ADR decides keep/untrack per Unknown tree with a live install trace as evidence;
README and `architecture.md` updated; if a tree is untracked, `.gitignore`, `paths.ts`,
`isTargetTracked` semantics and `V-TREE-01` updated in the same PR.
**Touch.** `documentation/decisions/ADR-029-*.md`, `documentation/decisions/INDEX.md`, README,
`documentation/architecture.md`, optionally `.gitignore` + `scripts/lib/build/*`.

### R-19 — Relocate orchestrator-side sections out of `worker-schemas.md`

**Evidence.** `worker-schemas.md` § Flush request (69 LOC, "the reverse direction") and
§ Orchestrator validation / Barrier triage / Blocked-iteration escalation (43 LOC) are not worker
return schemas; `hook-schemas.md` (#473) is the precedent for extracting non-contract content.
**AC.** Sections moved verbatim to `orchestrator-runtime.md` § Triage (or a new
`flush-request.md`), citations updated (`V-LINK-01`, `V-CITE-01`), `worker-schemas.md` below 850
LOC without any budget change, ADR-007 watch item (R-07) reads green or its row updated with the
revisit outcome.
**Touch.** `src/references/worker-schemas.md`, `src/references/orchestrator-runtime.md`, citations.

### R-20 — `skills.sh` harness-branch integration test

**Evidence.** `src/references/model-routing.md:171-173` marks the `skills.sh` inherit semantics
"Unverified until a harness integration test exists"; 31 `{{#host}}` conditional sites in 6
files have build-time tests only for stripping, not for the resolved routing outcome.
**AC.** A test compiles `model-routing.md` for the `skills` target and asserts the resolved
model ladder per role; the "Unverified" note removed or replaced by the test's citation.
**Touch.** `scripts/lib/build/content.ts` tests, `src/references/model-routing.md`.

### R-21 — macOS tmpdir hook tests

**Evidence.** On a clean checkout of `9274fbc` on macOS, `bun test` fails
`validate-file-changes.js › #510` and `#512` (expected exit 2, got 0): `os.tmpdir()` resolves under
`/private/var/folders/...`, which the guard does not classify as a broad root.
**AC.** Root cause documented in the test or hook header; either the guard treats the realpath of
`os.tmpdir()` as broad on darwin, or the tests construct a genuinely broad root portably; suite
green on macOS and Linux CI.
**Touch.** `templates/hooks/pretooluse/validate-file-changes.js` (+ mirrored bundles via build),
`scripts/hooks-validate-file.test.ts`.

## Verification for the epic

Epic closes when every child is merged and, on a clean checkout: `bun run verify` is green with
the new checks present (`V-SHAPE-01`, `V-WATCH-01`, `V-GATE-02`, `V-TREE-01`, `V-AUDIT-01`,
`V-CONTENTGATE-03`, `V-PROSE-01`, two ADR checks), `bun test` is green on macOS and Linux,
`reviewer.md` and `implementer.md` are shells under 250 LOC, and the retrospective's Phase 8
"Redesigned" column is re-measured and recorded as a `## Outcome` section in
`documentation/architecture/retrospective-blackhole.md` with `status: final`.
