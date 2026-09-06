---
type: plan
summary: "Planner ACs referencing a data structure's keys/values must cite the production read site, not the doc comment (issue #917)"
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-06
last_updated: 2026-09-06
related: [documentation/plans/plan-enum-source-local-const-name-by-members-collision-drop-path-has-no-test-a-future.md]
---

# Plan - Issue #917

## Objective
`planner.md` Step 6 ("Enforce V-codes (Plan-time checks)") lists plan-time checks the planner
runs on every track before writing a plan, but nothing there tells the planner to verify an AC's
claim about a data structure's keys/values/membership against the structure's actual production
call site before writing it down. Issue #883's AC #2 shows the failure mode concretely:
`.blackhole/plans/issue-883.md`'s AC #2 asserted
`LOCAL_CONST_NAME_BY_MEMBERS.has(name)` for `name` drawn from `WAIVABLE_ENUMS`
(`scripts/lib/worker-json/enum-source.ts:96`) — testing whether a constant *name* is a *key* of
`LOCAL_CONST_NAME_BY_MEMBERS`. But `LOCAL_CONST_NAME_BY_MEMBERS`'s keys are joined member-list
strings and its values are constant names (built at `enum-source.ts:96-127`; consumed at
`enum-source.ts:162`: `const constName = LOCAL_CONST_NAME_BY_MEMBERS.get(expectedJoined);` —
`.get()` takes a member-list string, a constant name comes back out). `.has(name)` on a
member-list-keyed map, called with a constant name, is on the wrong axis and returns `false`
regardless of whether the security-relevant collision the AC exists to catch has ever occurred —
the assertion is permanently false, not merely fragile.

Per `router-917`'s investigation (accepted): this is **not** a silent-ship gap. A permanently-false
test is caught by TDD red-before-green at implement time regardless of any plan-time fix; a
"fix" that inverts it into a permanently-vacuous assertion is caught by `V-TEST-11` (BLOCK,
unconditional on every diff touching tests) at review time regardless of any plan-time fix. What
this issue buys is moving that catch three steps left — planner catches the wrong axis before an
implementer burns a TDD cycle or a reviewer does `V-TEST-11` reasoning — a real, modest win, and
it must stay scoped like one: **prose only, no new V-code, no new blocking gate.**

A second, distinct leg: the orchestrator's own dispatch to `router-917`'s originating session
reproduced the same wrong-axis claim from issue #883 word-for-word when constructing a worker
prompt — it re-derived the claim from the structure's name/doc-comment rather than carrying the
plan's own citation forward, so a planner-only fix does not by itself close the loop. The fix
there is a **copy obligation** (quote a plan's `file:line` AC citation verbatim in the dispatch),
mirroring the existing "derived, not prosed ... carry those paths into the contract verbatim"
discipline `orchestrator-delegation.md` § Contended-path exclusions already applies to
Touch-Paths exclusions — not a second verification pass.

## Touch-Paths
- `src/agents/planner.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
  (6 generated copies confirmed on `origin/main` at `aa71138a`: `.agents/build/agents/planner.md`,
  `.claude/agents/planner.md`, `.cursor/agents/planner.md`, `agents/planner.md`,
  `plugins/blackhole-claude/agents/planner.md`, `codex-agents/planner.yaml`)
- `src/references/orchestrator-delegation.md` — plus all generated dist trees per
  `scripts/lib/build/targets.ts` (9 generated copies confirmed on `origin/main` at `aa71138a`:
  `.agents/build/skills/blackhole/references/orchestrator-delegation.md`,
  `.claude/skills/blackhole/references/orchestrator-delegation.md`,
  `.cursor/skills/blackhole/references/orchestrator-delegation.md`,
  `codex-skills/blackhole/references/orchestrator-delegation.md`,
  `plugins/blackhole-agent-plugins/skills/blackhole/references/orchestrator-delegation.md`,
  `plugins/blackhole-claude/skills/blackhole/references/orchestrator-delegation.md`,
  `plugins/blackhole/skills/blackhole/references/orchestrator-delegation.md`,
  `references/orchestrator-delegation.md`, `skills/blackhole/references/orchestrator-delegation.md`)

No other file changes. `bun run build` regenerates all listed dist copies from the two source
edits; the implementer must run it and commit the regenerated trees in the same PR — hand
duplicating any of the above copies is a Touch-Paths/`V-INT-02` violation of the build's own SSOT.

## Documentation Impact
`documentation/` search performed (grep for `enum-source|LOCAL_CONST_NAME_BY_MEMBERS|orchestrator-delegation` under `documentation/`): no doc describes planner AC-citation discipline or this
dispatch-fidelity rule. **None — this is a prompt-authoring rule for two build-input files
(`src/agents/planner.md`, `src/references/orchestrator-delegation.md`); it changes agent
behavior, not any consumer-facing documentation, schema, or API. `documentation/reference/decision-log.md`
is out of scope for this plan — appended by the orchestrator post-barrier from
`decision_records[]`, never by the planner or implementer (`orchestrator.md` § Decision Record
Append; `implementer.md:184-186`).**

## Task Steps

- [ ] **TDD Baseline Verification**: This is a prompt-only change to two markdown source files —
  there is no code-level test suite to baseline. Instead, run `bun run build` once before editing
  to confirm the build is currently green and the dist trees for both files match their sources
  byte-for-byte (`git status --porcelain` empty after the build). — **AC**: pre-edit build
  succeeds with zero diff.

- [ ] **Red-before-green demonstration (documented, not an automated test — prompt-only change)**:
  Before editing, re-derive issue #883's AC #2 twice and record both derivations in the PR
  description, exactly as follows (this dual derivation *is* the falsifiable content of this
  issue — it is what makes the rule demonstrable rather than decorative):
  - **RED — from the map's name and doc comment alone**: `LOCAL_CONST_NAME_BY_MEMBERS`'s name
    ("constant name, by members") and its doc comment at `enum-source.ts:103-108` ("Maps a
    local, trusted `constants.ts` array's exact member list ... back to the exported constant
    name that declares it") are read without tracing a call site. A reasonable-looking but wrong
    derivation from this alone is: "I want to check the map knows about `WAIVABLE_ENUMS`'s
    names, so I check `.has(name)`" — the axis (`keys()` vs `values()`) is not forced by the
    name or comment alone; the doc comment states it correctly but does not stop the wrong
    reading, exactly as it did not stop it in `.blackhole/plans/issue-883.md`'s AC #2.
    Reproduce: `LOCAL_CONST_NAME_BY_MEMBERS.has('COMPANION_REPAIR_VCODES')` — **evaluates to
    `false` today**, on unmodified `origin/main`, with no collision present at all. This is the
    RED state: the assertion `expect(...).toBe(true)` fails immediately, not just after some
    future regression — issue #883's own AC #2 is already broken at baseline, before any
    collision ever occurs.
  - **GREEN — from the production call site**: `enum-source.ts:162`,
    `const constName = LOCAL_CONST_NAME_BY_MEMBERS.get(expectedJoined);`, read together with the
    line before it (`const [, , value, expectedJoined] = match;`) and the check after it
    (`WAIVABLE_ENUMS.has(constName)`). This shows unambiguously: the argument to `.get()` is a
    member-list string (`expectedJoined`), and what comes back out (`constName`) is a constant
    name, later checked against `WAIVABLE_ENUMS`. So "is `WAIVABLE_ENUMS` member X still
    resolvable" is a question about the map's **values**, not its keys. Reproduce:
    `Array.from(LOCAL_CONST_NAME_BY_MEMBERS.values()).includes('COMPANION_REPAIR_VCODES')` —
    evaluates to `true` today. This is the GREEN state, and it is the correct AC #2 assertion.
  — **AC**: PR description contains both derivations verbatim (RED evaluating to `false`/failing,
  GREEN evaluating to `true`/passing), quoting the exact `enum-source.ts` line numbers cited
  above, re-verified against `origin/main` at implement time (line numbers may have shifted).

- [ ] **Edit `src/agents/planner.md`**: Add the `V-INT-03` — Data-structure orientation citation
  bullet to Step 6 ("Enforce V-codes (Plan-time checks)"), as a fourth bullet alongside the
  existing `V-INT-02`/`V-KISS-01`/`V-YAGNI-01` bullets. Exact replacement text below (see
  "Exact Replacement Prose" section). — **AC**: `git diff src/agents/planner.md` shows only this
  bullet added under Step 6; no other line in the file changes; `grep -c "V-INT-03" src/agents/planner.md` increases by at least 1.

- [ ] **Edit `src/references/orchestrator-delegation.md`**: (a) extend field 1 (Objective)'s
  one-line description with a pointer to a new subsection; (b) add a new `### AC Citation
  Fidelity` subsection immediately before the existing `### Contended-path exclusions`
  subsection, mirroring its "derived, not prosed ... carry verbatim" framing. Exact replacement
  text below. — **AC**: `git diff src/references/orchestrator-delegation.md` shows only field 1's
  sentence extended and the new subsection inserted; the existing `### Contended-path exclusions`
  section body is byte-for-byte unchanged.

- [ ] **Rebuild and commit dist trees**: Run `bun run build`. — **AC**: build exits 0; `git status
  --porcelain` shows changes in exactly the two source files plus the generated-copy paths listed
  under Touch-Paths above (6 for `planner.md`, 9 for `orchestrator-delegation.md`) — no other file
  changes.

- [ ] **Verify Integrity**: Run the full test/lint/typecheck suite (`bun run verify` or the
  project's equivalent) and `scripts/checks/content-gates.check.ts`'s content-gate check
  specifically (both touched files are grandfathered/class-budgeted — see Quality Gate Results
  below for headroom). — **AC**: full suite green, lint/typecheck clean, content-gate check
  reports no new `V-CONTENTGATE-01` finding for either file, all quoted in the completion
  evidence.

## Exact Replacement Prose

### `src/agents/planner.md` — Step 6, new fourth bullet (insert after the existing `V-YAGNI-01` bullet, before the numbered "7." step)

```markdown
   * `V-INT-03` — **Data-structure orientation citation** (issue #917): before writing an AC
     that asserts something about a data structure's keys, values, or membership (`.has(`,
     `.get(`, `keys()`, `values()`, "maps X to Y", "reverse lookup", `⊆`), read the
     **production call site** that actually consumes the structure — never its declaration,
     name, or doc comment alone — and cite it `file:line` in the AC. A structure's name and doc
     comment describe intent; only a call site shows which side of the mapping is the key and
     which is the value. Same shape as the Design Track's ADR citation check (§4 subsection 2,
     issue #775): verify a citation against its live source before an AC relies on it, never
     against the source's own summary of itself. Issue #883's AC #2 is the worked failure case:
     it read `LOCAL_CONST_NAME_BY_MEMBERS`'s name and doc comment
     (`scripts/lib/worker-json/enum-source.ts:103-108`) and asserted
     `LOCAL_CONST_NAME_BY_MEMBERS.has(name)` for a `name` drawn from `WAIVABLE_ENUMS` — testing
     membership on the map's *keys* (joined member-list strings), when `name` is one of the
     map's *values* (constant names). The map's own production consumer at
     `enum-source.ts:162` (`const constName = LOCAL_CONST_NAME_BY_MEMBERS.get(expectedJoined);`)
     shows the correct axis in one line: `.get()`/`.has()` takes a member-list string and a
     constant name is what comes back out, so the AC needed
     `Array.from(LOCAL_CONST_NAME_BY_MEMBERS.values()).includes(name)`, not `.has(name)`.
     **This is a citation-discipline obligation, not a new gate**: no new V-code, no CLI check
     (Step 8's `plan-quality-gate.ts` checks form — a literal `**AC**:` marker — not whether a
     cited `file:line` supports the axis the AC actually tests; that requires reading the call
     site and understanding it, which is judgment, not a parseable form). The backstop this
     narrows the window on already exists and is unconditional: `V-TEST-11` (BLOCK) catches a
     structurally unfalsifiable test at review time regardless of this bullet, and TDD
     red-before-green catches a permanently-false test at implement time regardless of this
     bullet. This obligation's entire value is moving that catch three steps left — to plan
     time — not closing a gap that would otherwise ship silently.
```

### `src/references/orchestrator-delegation.md` — field 1 sentence extension (in place, same line)

Before:
```
1.  **Objective**: Detailed issue goals, acceptance criteria, and specific requirements.
```
After:
```
1.  **Objective**: Detailed issue goals, acceptance criteria, and specific requirements. When a plan's AC carries a `file:line` production-call-site citation (`planner.md` Step 6, `V-INT-03` — data-structure orientation citations), quote that citation **verbatim** in the dispatch — see § AC Citation Fidelity below.
```

### `src/references/orchestrator-delegation.md` — new subsection (insert immediately before `### Contended-path exclusions`)

```markdown
### AC Citation Fidelity

When a plan's AC cites a `file:line` production call site to justify a claim about a data
structure's keys, values, or membership (`planner.md` Step 6, `V-INT-03`, issue #917), field 1
carries that citation into the worker prompt **verbatim** — never re-paraphrased. This is the
same discipline § Contended-path exclusions above already applies to Touch-Paths exclusions
("derived, not prosed ... carry those paths into the contract verbatim"): a re-paraphrase can
silently drift onto the wrong axis of the cited structure (its keys vs. its values, its
declaration vs. its consumer) even when the plan's own citation was correct, because
re-deriving the claim from the structure's name or doc comment reopens exactly the failure mode
the citation exists to close.

This is a copy obligation, not a second verification pass — the orchestrator does not re-check
the citation's correctness (that judgment belongs to planning, `planner.md` Step 6); it only
ensures the dispatch does not silently diverge from a citation the plan already got right.
Issue #917's incident showed why this matters even when planner-side discipline exists: a
dispatch that reproduces a plan's wrong claim word-for-word is not caught by a planner-only fix,
because the orchestrator's own re-paraphrasing step is a second, independent place the same
error can be introduced or preserved.

```

## Regex Proxy Decision — excluded

`router-917`'s investigation sketched an optional advisory regex proxy: flag an AC bullet using
membership vocabulary (`.has(`, `.get(`, `keys(`, `values(`, `⊆`) with no `file:line`-shaped
citation nearby. **Decision: excluded, not wired in.** Reasoning: it is a presence check, not a
correctness check, and issue #883's own broken AC #2 already carried a `file:line`-shaped
citation — just the wrong one (the map's declaration/doc-comment line, not its production read
site at `enum-source.ts:162`). A regex proxy checking only for citation *presence* would have
passed AC #2 exactly as written, producing false confidence that citation correctness had been
verified when it had not. Building the check anyway, knowing it cannot distinguish a correct
citation from a wrong one on the one real incident this issue is about, is reaching for a check
because it feels more solid than prose — rejected per explicit instruction. This obligation
stays pure prose, backstopped by `V-TEST-11` and TDD red-before-green as stated in the Objective.

## Sprint Contract
- Red-before-green demonstration (both derivations, RED failing / GREEN passing, quoted
  `enum-source.ts` line numbers) — PASS required, recorded in the PR description.
- `planner.md` Step 6 gains exactly one new bullet (`V-INT-03`) — PASS required.
- `orchestrator-delegation.md` field 1 gains one sentence and one new `### AC Citation
  Fidelity` subsection, `### Contended-path exclusions` body unchanged — PASS required.
- All listed dist copies (6 + 9) regenerated via `bun run build`, no hand-edited dist file —
  PASS required.
- Full suite + lint/typecheck + content-gate check green — PASS required (definition of done
  for all remaining, non-AC-bearing steps).

## Quality Gate Results (CLI, advisory on Quick Track — see note)
Quick Track carries neither `## Task Breakdown` nor `## Critical Files` nor
`## Execution Strategy & Stop Conditions` (it uses `## Task Steps` instead, per
`planner.md` § Plan Complexity Tracks & Sections), so `scripts/plan-quality-gate.ts`'s three
checks are structurally inert here (section-presence gating, not track-gating —
`planner.md` Step 8's "mercure parity" note) — they report `true` because their source section
is absent, not because Quick Track is exempted. Run and reported below per explicit request:

| Check | Result |
|---|---|
| `ac_mapping` | PASS (advisory — no `## Task Breakdown` section on Quick Track) |
| `critical_files_exist` | PASS (advisory — no `## Critical Files` section on Quick Track) |
| `mitigation_concrete` | PASS (advisory — no `## Execution Strategy & Stop Conditions` section on Quick Track) |
