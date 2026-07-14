---
type: analysis
status: current
review_trigger: "on release"
created: 2026-07-06
last_updated: 2026-07-06
related:
  - documentation/decisions/ADR-003-synthesizer-removal.md
---

# Architecture Coherence Audit — post-rename (#64) and v0.5.0 cycle

**Scope**: read-only structural audit of `scripts/build.ts` / `scripts/verify.ts` coupling,
naming residue after the `bc-campaign` → `blackhole` rename, `src/` SSOT vs.
compiled-mirror boundary clarity, dead code from the `bc-synthesizer` removal
([ADR-003](../decisions/ADR-003-synthesizer-removal.md)), and a full root-folder inventory.
**No refactoring was performed for this issue** — every finding below is presented for
separate, explicitly-approved follow-up work.

**Baseline evidence** (fresh, this session): `bun test` → 141 pass, 0 fail, 288 `expect()`
calls, 10 files. `bun run verify` → 18/18 checks passed. `bun run doctor` → 5 BLOCK passed,
0 WARN. No regressions; this audit changes zero source files.

## Summary of findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| F1 | MEDIUM | Coupling | `verify.ts` re-derives its own inline copy of the 3-item rules list instead of importing `build.ts`'s SSOT |
| F2 | MEDIUM | Coupling | `checkCodexBuild` bundles 4 distinct V-code checks in one 115-line function, exceeding this repo's own 80-LOC step ceiling |
| F3 | HIGH | Naming residue | GitHub repository has been renamed `backlog-campaign` → `blackhole`, but code and docs still assert (and generate) the old repo slug in URLs |
| F4 | — (RESOLVED) | Naming residue / SSOT | `.bc-campaign/` → `.blackhole/` runtime-directory migration, open at plan time, is now complete |
| F5 | MEDIUM | SSOT/mirror boundary | No compiled mirror file carries an in-file "generated, do not hand-edit" marker; `cleanDir()` silently discards hand-edits on next build |
| F6 | MEDIUM | Dead code | Two orphaned `bc-synthesizer`-era fixture files in `fixtures/worker-json/` are read by no script or test |
| F7 | MEDIUM | Dead code / docs | `ADR-002` and `ADR-003` both link to a non-existent analysis doc |
| F8 | MEDIUM | Docs staleness | `ADR-001` line 20 and line 23 are stale relative to `ADR-003` and the `.blackhole/` migration |
| F9 | LOW | SSOT/mirror boundary | Root `ARCHITECTURE.md` (capitalized) absent — sanctioned by ADR-095, not a gap |
| F10 | LOW | Naming residue | `templates/` and `.git`/`.github` naming/ownership all confirmed clean |

No CRITICAL findings. No refactoring applied — see individual sections for defer-vs-fix framing.

---

## 1. Coupling/duplication — `scripts/build.ts` (586 lines) and `scripts/verify.ts` (813 lines)

### Shared-literal duplication check

`verify.ts:4` already imports `AGENTS_BUILD_ROOT`, `AGENTS_BUILD_AGENT_DIR`,
`DISTRIBUTION_ROOT`, `AGENT_MD_FILES`, `AGENT_YAML_FILES` from `build.ts` — these lists are
correctly single-sourced, no duplication.

**F1 (MEDIUM)** — `build.ts:209` defines `const rulesList = ['blackhole-protocol.md',
'blackhole-state.md', 'blackhole-vcodes.md']` but does **not** export it. `verify.ts:345`
re-derives its own identical inline literal: `for (const rule of ['blackhole-protocol.md',
'blackhole-state.md', 'blackhole-vcodes.md'])`. This is inconsistent with the pattern
already established in the same file for `AGENT_NAMES`/`AGENTS_BUILD_ROOT`/
`DISTRIBUTION_ROOT` (properly imported, single source). If a fourth rule file is ever added
to `build.ts`'s `rulesList`, `verify.ts:345`'s copy silently drifts out of sync with no
compiler error. **Recommendation** (deferred): export `rulesList` from `build.ts` and import
it in `verify.ts`, mirroring the existing import block at `verify.ts:4`.

### `verify.ts`'s check structure — god-file or grouped?

`verify.ts` runs 18 independent, single-purpose top-level check functions from `main()`
(`verify.ts:775-813`): `checkAgentToolPolicy`, `checkAgentFrontmatter`,
`checkDelegationContracts`, `checkPhaseNames`, `checkVcodeReferences`, `checkFixtures`,
`checkPlanArtifacts`, `checkSkillModes`, `checkGroundTruth`, `checkEpicRunbook`,
`checkCheckpointAlignment`, `checkBuild`, `checkGeminiBuild`,
`checkGeminiDistributionBundle`, `checkCodexBuild` (`checkCodexBuild` emits 4 V-codes,
counted separately in `expectedChecks`). This is **not** a god-file — each check is its own
named function with a clear single concern, and `main()` is a flat, readable dispatch list.
LOW/informational — no finding.

**F2 (MEDIUM)** — one check exceeds this repo's own step-ceiling convention (the
`mercure-extension-tax.md` "80 LOC after edit" ceiling, applied here as the natural
verify.ts-local analogue since each `check*` function is this file's unit of
single-responsibility): `checkCodexBuild` (`verify.ts:461-575`, **115 lines**) bundles 4
distinct conceptual checks into one function body:
- `V-CODEX-01` (`verify.ts:462-472`) — runs `bun run build` and asserts exit 0
- `V-CODEX-02` (`verify.ts:474-508`) — validates `.codex-plugin/plugin.json` and
  `codex-marketplace.json` shape
- `V-CODEX-03` (`verify.ts:510-520`) — validates `codex-skills/blackhole/SKILL.md` contains
  `disable-model-invocation: true`
- `V-CODEX-04` (`verify.ts:522-574`) — validates all 5 `codex-agents/*.yaml` files' frontmatter
  shape and scans `codex-skills/**/*.md` for un-stripped platform conditionals

Each already emits its own V-code via independent `pass()`/`fail()` calls, so splitting into
4 functions (`checkCodexBuild`, `checkCodexManifest`, `checkCodexSkill`, `checkCodexAgents`)
is mechanical and low-risk — but that is refactoring, out of scope for this issue.
**Recommendation** (deferred): split per the V-code boundaries above.

### `build.ts`'s multi-target compile responsibility

`build.ts` compiles `src/` to 5 target trees (skills.sh flat, Cursor, Claude, Codex,
Gemini/Antigravity workspace + distribution — `compileGeminiTree` at `build.ts:276`,
`compileCodexTree` at `build.ts:355`, inline Cursor/Claude blocks in `main()` at
`build.ts:443-515`). Cleanup (`cleanDir`, `build.ts:25-29`) is a single reused helper called
only from `main()`, not mixed into the per-target compile functions themselves. This is
cohesive "compile SSOT → N targets" responsibility — no unrelated concerns found mixed into
the compile functions. No finding.

---

## 2. Naming consistency post-rename (#64)

### DR-2 legacy-detection literals — confirmed location

`scripts/doctor.ts:20-21` (`LEGACY_SKILL_NAMES = ['bc-campaign', 'backlog-campaign']`) and
`scripts/doctor.ts:241-244` are the intentional, allow-listed legacy-detection literals —
confirmed, not `verify.ts` as the issue body's phrasing might suggest. `scripts/install-verify.ts:24,53-54`
carries the equivalent pattern (`OWN_SYMLINK_NAME_PATTERN`, `legacyPathBc`,
`legacyPathBacklog`) for the separate `install:verify` workstation audit. Both are expected,
intentional. No finding.

### Full residue grep — triage

`grep -rn "bc-campaign|bc_campaign|bc-coordinator|bc-orchestrator|bc-implementer|bc-planner|bc-reviewer|bc-synthesizer|backlog-campaign" --include="*.ts" --include="*.md" --include="*.json" .`
(excluding `node_modules/`, `.git/`) triages as follows:

| Category | Files | Verdict |
|----------|-------|---------|
| Intentional (DR-2 legacy detection) | `scripts/doctor.ts:20-21,241-244`, `scripts/install-verify.ts:24,53-54` | Keep |
| Historical record | `documentation/decisions/ADR-001/002/003` (`tracking_initiative: backlog-campaign-v2` frontmatter, decision prose), `.github/releases/v0.1.0.md`…`v0.4.2.md`, `.claude/skills/prj-create-release/SKILL.md` | Keep — accurate record of naming at time of authorship |
| Test literal (context read) | `scripts/validate-worker-json.test.ts:74` — `resolveRole({ subagent_type: 'bc-synthesizer' })` expects `null` | Keep — deliberate legacy-role-rejection regression test (confirmed by reading `scripts/validate-worker-json.test.ts:69-85`: sibling assertions cover current bare/plugin-scoped roles, this one specifically guards against a removed role resolving to a truthy value) |
| Legacy-generation test fixtures | `scripts/install-verify.test.ts:113-131,188-198,261-281`, `scripts/doctor.test.ts:107-120` | Keep — these deliberately construct `bc-campaign`/`backlog-campaign`-named symlinks/dirs to test the legacy-detection code paths above |
| Live state directory name | `.bc-campaign/` | **RESOLVED — see §3, F4** |
| **Candidate residue** | `scripts/build.ts:235-236,247,265`, `.codex-plugin/plugin.json`, `codex-marketplace.json`, `fixtures/codex-plugin.example.json`, `fixtures/codex-marketplace.example.json`, `README.md` (10+ occurrences), `CLAUDE.md:12` | **F3, HIGH — see below** |

### F3 (RESOLVED) — GitHub repository rename not reflected in generated URLs

Fresh verification this session:

```
$ git remote -v
origin  https://github.com/CorentinLumineau/blackhole.git (fetch/push)
$ gh repo view --json name,nameWithOwner,url
{"name":"blackhole","nameWithOwner":"CorentinLumineau/blackhole","url":"https://github.com/CorentinLumineau/blackhole"}
```

The canonical GitHub repository is now **`CorentinLumineau/blackhole`**, not
`backlog-campaign`. This directly contradicts the repo's own documented design decision at
`README.md:219-228` ("Harness | Stays `backlog-campaign`" table, explicitly stating "GitHub
repository | `CorentinLumineau/backlog-campaign` | Marketplace URLs, `gh`, CI, submodule
remotes"). That design premise assumed the repo slug would never change; it has.

Concrete, generated (not just prose) artifacts on disk still hardcode the old slug:

- `scripts/build.ts:235-236` (`buildCodexPluginManifest`):
  `homepage: 'https://github.com/CorentinLumineau/backlog-campaign'`,
  `repository: 'https://github.com/CorentinLumineau/backlog-campaign'`
- `scripts/build.ts:247`: `websiteURL: 'https://github.com/CorentinLumineau/backlog-campaign'`
- `scripts/build.ts:265` (`buildCodexMarketplace`): `url: 'https://github.com/CorentinLumineau/backlog-campaign'`
- Generated output reflecting the above: `.codex-plugin/plugin.json:10-11,31`,
  `codex-marketplace.json:11`
- Fixture mirrors of the same stale shape: `fixtures/codex-plugin.example.json:10-11,22`,
  `fixtures/codex-marketplace.example.json:9`
- Install instructions: `CLAUDE.md:12` (`/plugin marketplace add
  https://github.com/CorentinLumineau/backlog-campaign`), and `README.md:124,137,145,150,157,162,164,177,180,205,214,221-228,236,242`

This is ranked HIGH rather than MEDIUM because it is not cosmetic: every documented install
pathway (Claude Code marketplace, skills.sh, Cursor submodule, Codex CLI marketplace) and
every generated Codex manifest URL point at a GitHub slug that is no longer the repository's
name. GitHub's automatic rename-redirect likely keeps these links functional today, but that
is an implicit, fragile safety net the docs do not acknowledge, and it directly contradicts
the explicit rationale table the docs assert. **Recommendation** (deferred, separately
approved issue): either (a) update `build.ts`'s hardcoded URLs plus `README.md`/`CLAUDE.md`
to the new `blackhole` slug and drop the "stays `backlog-campaign`" rationale table, or (b)
if the rename was unintentional/reversible, revert the remote and confirm the intended
canonical slug before touching any of the above — this audit does not have enough context to
know which direction is correct, only that code and reality currently disagree.

**Re-verified fresh this session**: PR #77 (`Closes #73`) fixed every location this finding
lists. `grep -rn "CorentinLumineau/backlog-campaign" --include="*" .` (excluding `.git/`) now
returns zero hits in `scripts/build.ts`, `.codex-plugin/plugin.json`,
`codex-marketplace.json`, `fixtures/codex-plugin.example.json`,
`fixtures/codex-marketplace.example.json`, `CLAUDE.md`, or `README.md` — the only remaining
matches are this document's own prose (quoting the pre-fix state as history) and
`documentation/audits/platform-build-verification.md`'s "Known Discrepancy #2" entry, which
already notes the fix was in flight. `README.md:219-228`'s rationale table has been replaced
by a `#### Identifiers: repo slug vs plugin id` section stating the repo slug and plugin id
are now the same string (`blackhole`) everywhere. This is now consistent with the renamed
repository and requires no follow-up. Noting the resolution here (rather than silently
omitting it) so the audit's own findings ledger doesn't re-report a stale drift in a future
re-read of this document — issue #79 was filed 12 minutes after #73 closed, off this exact
stale finding, before the annotation below existed.

### Cross-file name consistency (unaffected by F3)

`package.json:2` (`"name": "blackhole"`), `.claude-plugin/plugin.json:2`
(`"name": "blackhole"`), `.claude-plugin/marketplace.json` (`"name":
"blackhole-marketplace"`, nested plugin `"name": "blackhole"`) are all mutually consistent
and consistent with `src/SKILL.md` and `ADR-001`. No residue here — F3 is specifically about
the GitHub repo *slug* embedded in URLs, not the plugin/package *id*.

---

## 3. `src/` SSOT vs. compiled-mirror boundary clarity

`documentation/architecture.md` (frontmatter `type: reference`, `review_trigger: "on build
target change"`) already documents this boundary well: a Mermaid build-pipeline diagram plus
a "Committed target trees" table. This section checks that doc against actual disk state,
per the plan — it does not re-litigate whether the doc exists.

### F4 (RESOLVED) — `.bc-campaign/` → `.blackhole/` runtime directory migration

At plan time, `README.md:289` and `documentation/architecture.md:46` both stated the
campaign runtime protocol SSOT lives at `.blackhole/`, while the actual live directory on
disk was `.bc-campaign/` — a dogfooding gap. **Re-verified fresh this session**: the
migration has since completed.

```
$ ls -la <repo root>
...
.blackhole/   (present)
.bc-campaign/ (absent — grep/find confirm zero matches)
```

`.blackhole/config.json` confirms `"repo": "CorentinLumineau/blackhole"` and contains
`queue.json`, `findings-ledger.json`, `plans/`, `archive/`, matching
`README.md:246-253`'s documented manual migration step (`mv .bc-campaign .blackhole`). This
is now consistent with docs and requires no follow-up. Noting the resolution here (rather
than silently omitting it) so the audit's own findings ledger doesn't re-report a stale
drift in a future re-read of this document.

Note: this also means `documentation/decisions/ADR-001-five-phase-lifecycle.md:23`'s
`.bc-campaign/queue.json` reference is now stale in the same way — folded into **F8** below
rather than duplicated here.

### F5 (MEDIUM) — no in-file "generated, do not hand-edit" marker on any compiled mirror

The plan asked whether mirrored files carry a generated-file marker, "present, absent, or
inconsistent across mirror targets." Spot-checked `.claude/skills/blackhole/references/phase-plan.md`,
`.claude/agents/planner.md`, `.cursor/agents/planner.md`, `.agents/build/agents/planner.md`,
and `skills/blackhole/SKILL.md` against their `src/` sources: **none carry an in-file
generated/do-not-edit header** — guidance exists only as prose in
`documentation/architecture.md`'s table ("Edit via `src/` only — never hand-edit"), external
to the generated files themselves. This is uniform absence, not inconsistency, across every
mirror target checked.

This matters because `build.ts:402-417`'s `cleanDir()` calls wipe `rules/`, `agents/`,
`skills/`, `references/`, `.cursor/`, `.claude/`, `.claude-plugin/` (and, with `--gemini`,
`.agents/build/`, `.gemini-plugin/`, `plugins/blackhole/`; and with default Codex build,
`codex-agents/`, `codex-skills/`, `.codex-plugin/`) unconditionally on every `bun run build`.
A contributor who hand-edits, say, `.claude/agents/planner.md` directly gets no in-file
warning and loses the edit silently on the next build. **Recommendation** (deferred): add a
single-line comment/frontmatter marker (e.g. `<!-- GENERATED by scripts/build.ts from
src/agents/planner.md — do not hand-edit -->`) emitted by `processFile`/`compileFolder`.

### Mirror-target list vs. actual `build.ts` write targets

Enumerated every `path.join(root, ...)` write-target call site in `build.ts` (cleanup +
compile). Cross-checked against `documentation/architecture.md`'s "Committed target trees"
table and `README.md:283-293`'s Repository layout table: **all targets match** — `rules/`,
`agents/`, `skills/`, `references/` (skills.sh flat), `.cursor/`, `.claude/` +
`.claude-plugin/`, `codex-agents/` + `codex-skills/` + `.codex-plugin/` +
`codex-marketplace.json`, `.agents/build/` + `.gemini-plugin/`, `plugins/blackhole/`. No
target-list mismatch found. No finding.

### F9 (LOW) — root `ARCHITECTURE.md` absent

Confirmed via fresh `ls -la`: no capitalized `ARCHITECTURE.md` at repo root, only lowercase
`documentation/architecture.md`. Per ADR-095 (an external convention governing companion-file
naming — not a file in this repo's `documentation/decisions/`, which contains only
`ADR-001`..`ADR-003`), a `documentation/architecture.md` comprehension-only doc is the
sanctioned form. LOW/informational — naming-convention divergence from a generic
companion-file convention, not a missing-doc gap.

---

## 4. Dead code from the `bc-synthesizer` removal ([ADR-003])

Confirmed `src/agents/` contains exactly 5 files: `coordinator.md`, `implementer.md`,
`orchestrator.md`, `planner.md`, `reviewer.md` — no `bc-synthesizer.md`. Confirmed
`build.ts:212`'s `AGENT_NAMES` has exactly 5 entries, no synthesizer. Confirmed
`grep -rn "synthesizer" scripts/ src/ .claude-plugin/` returns exactly one hit:
`scripts/validate-worker-json.test.ts:74`, the intentional rejection test discussed in §2.

### F6 (MEDIUM, new finding) — orphaned synthesizer fixture files

`fixtures/worker-json/synthesizer-approved.json` and
`fixtures/worker-json/synthesizer-invalid-status.json` exist on disk but are **read by no
script or test**: `grep -rn "synthesizer-approved\|synthesizer-invalid-status" --include="*.ts" .`
returns zero hits, and `scripts/validate-worker-json.test.ts:12`'s `fixturesDir` helper reads
fixture files by explicit name (no directory scan that would incidentally pick these up).
These are dead fixtures left over from the pre-[ADR-003] synthesizer pipeline that were never
removed when the agent was deleted. No functional impact (nothing executes them), but they
are exactly the kind of orphaned reference this audit dimension was scoped to find.
**Recommendation** (deferred): delete both files in a follow-up cleanup issue.

### F7 (MEDIUM) — dangling internal doc link

`documentation/decisions/ADR-002-synthesizer-extraction.md:39` and
`documentation/decisions/ADR-003-synthesizer-removal.md:12` both link to
`documentation/audits/analysis-bc-synthesizer-yagni.md`. Confirmed this file **does not
exist on disk** — `documentation/audits/` contained zero files before this audit created
`architecture-coherence.md`. Per this issue's explicit instruction, this is reported only,
not fixed (creating a stub file would be out-of-scope remediation). **Recommendation**
(deferred): either restore the original analysis doc from history if it exists in git log,
or update both ADRs to remove the dead link / replace it with an inline summary.

### F8 (MEDIUM) — `ADR-001` stale relative to `ADR-003` and the `.blackhole/` migration

`documentation/decisions/ADR-001-five-phase-lifecycle.md:20`: "Review — V-code audit via
reviewer + synthesizer pipeline" is stale — [ADR-003] replaced the LLM synthesizer agent with
deterministic `scripts/review-aggregate.ts`, and `ADR-001` was never updated or marked
amended for this line. `ADR-001-five-phase-lifecycle.md:23`: "State is persisted in
`.bc-campaign/queue.json`" is likewise stale following the (now-resolved, see F4) migration
to `.blackhole/queue.json`. Neither line has been touched since the respective superseding
decisions landed. **Recommendation** (deferred): amend `ADR-001` lines 20 and 23, or add a
short "Amendment" section noting both changes with links to `ADR-003` and the migration
commit, consistent with how `ADR-002` itself carries a `superseded_by: ADR-003` frontmatter
field.

---

## 5. Root-folder inventory

Fresh `ls -la` at repo root this session (not the plan-time snapshot) confirms **22 real
folders** (13 visible + 9 dot-prefixed) — identical composition to the plan-time snapshot
except `.bc-campaign/` → `.blackhole/` (see F4). Tracked-file counts below are from
`git ls-files <dir> | wc -l`, run fresh, not inferred from `.gitignore` patterns alone (a
pattern's presence doesn't prove nothing under it is tracked — see `.gemini-plugin/` and
`.agents/` below, both governed by re-inclusion negations).

| Folder | Owner/producer | Tracked? | Verdict |
|--------|-----------------|----------|---------|
| `agents/` | Build output — skills.sh flat mirror | Tracked (5 files) | Justified |
| `codex-agents/` | Build output — Codex CLI | Tracked (5 files) | Justified |
| `codex-skills/` | Build output — Codex CLI | Tracked (25 files) | Justified |
| `documentation/` | Hand-authored source | Tracked (5 files, 6 after this PR) | Justified |
| `fixtures/` | Hand-authored test fixtures | Tracked (17 files) | Justified — 2 files orphaned, see F6 |
| `node_modules/` | Tooling (`bun install`) | Gitignored (0 tracked) | Justified |
| `plugins/` | Build output — Antigravity/Gemini distribution bundle | Tracked (29 files) | Justified |
| `references/` | Build output — skills.sh flat mirror | Tracked (24 files) | Justified |
| `rules/` | Build output — skills.sh flat mirror | Tracked (3 files) | Justified |
| `scripts/` | Hand-authored source | Tracked (21 files) | Justified |
| `skills/` | Build output — skills.sh flat mirror | Tracked (25 files) | Justified |
| `src/` | Hand-authored SSOT (the only edit surface) | Tracked (30 files) | Justified |
| `templates/` | Hand-authored (hook template) | Tracked (1 file) | Justified — single-artifact folder is intentional, not sparse-to-a-fault |
| `.agents/` | Build output (`.agents/build/` only, via `!.agents/build/` negation) + ephemeral handoff dirs (gitignored by design) | Tracked (33 files, all under `build/`) | Justified — split between build output and ephemeral is intentional and documented in `documentation/architecture.md` |
| `.blackhole/` | Runtime state — protocol SSOT | Gitignored (0 tracked) | Justified — present and correct, see F4 |
| `.claude/` | Build output — Claude Code project-level mirror | Tracked (33 files) | Justified |
| `.claude-plugin/` | Build output — Claude Code plugin manifest | Tracked (2 files) | Justified |
| `.codex-plugin/` | Build output — Codex CLI plugin manifest | Tracked (1 file) | Justified as a folder; content stale, see F3 |
| `.cursor/` | Build output — Cursor mirror | Tracked (34 files) | Justified |
| `.gemini-plugin/` | Build output — Gemini plugin manifest (`plugin.json` only, via `!.gemini-plugin/plugin.json` negation) | Tracked (1 file) | Justified |
| `.git/` | Git internal | N/A | Justified (universal) |
| `.github/` | Tooling/forge-owned — CI workflows, release docs, maintainer rules/skills | Tracked (13 files) | Justified |

**F10 (LOW)** — no orphaned, redundant, or unclear-purpose folders found at the root level.
Every folder maps 1:1 to either a documented build target, hand-authored source, gitignored
runtime/tooling state, or forge-owned tooling. `.github/workflows/*.yml` were also grepped
for `bc-campaign`/`backlog-campaign`/`blackhole` residue — clean, no stale references found
in CI.

---

## Recommendations (deferred — no action taken in this issue)

All remediation below requires separate approval per this issue's Sprint Contract ("no
refactoring performed — findings presented for separate approval"):

1. **F3 (HIGH)** — resolve the GitHub repo-slug divergence: decide whether `blackhole` or
   `backlog-campaign` is the intended canonical slug, then align `build.ts`, `README.md`,
   `CLAUDE.md`, and both `fixtures/codex-*.example.json` files accordingly.
2. **F1, F2 (MEDIUM)** — export `rulesList` from `build.ts` for `verify.ts` to import; split
   `checkCodexBuild` into 4 single-purpose functions along its existing V-code boundaries.
3. **F5 (MEDIUM)** — add an in-file generated-file marker to every compiled mirror target.
4. **F6 (MEDIUM)** — delete the two orphaned `fixtures/worker-json/synthesizer-*.json` files.
5. **F7, F8 (MEDIUM)** — fix the dangling `ADR-002`/`ADR-003` link, and amend `ADR-001`
   lines 20 and 23 for the synthesizer removal and `.blackhole/` migration.

[ADR-003]: ../decisions/ADR-003-synthesizer-removal.md
