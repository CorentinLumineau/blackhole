---
type: plan
summary: "Implementation plan closing the audit's missing agent-plugins tree row (issue #937): adds Evidence-table row 11 with an evidence-derived Unknown disposition, updates the Classification summary, and adds an explicit 8/8 COMMITTED_TARGET_TREES coverage statement to documentation/audits/build-tree-install-resolution.md"
status: current
review_trigger: "on file change"
created: 2026-09-07
last_updated: 2026-09-07
related:
  - documentation/audits/build-tree-install-resolution.md
  - documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md
  - documentation/decisions/ADR-038-unknown-build-tree-dispositions.md
---

# Plan - Issue #937

## Objective

`documentation/audits/build-tree-install-resolution.md` classifies every tree in
`scripts/lib/build/paths.ts`'s `COMMITTED_TARGET_TREES` except one: `agent-plugins` →
`plugins/blackhole-agent-plugins/` (added by PR #484 / ADR-025, after the audit's stated base
ref). The tree has no Evidence-table row, no Classification-summary entry, and zero mentions
anywhere in the document (`grep -c agent-plugins` on the live file returns `0`). Close the gap:
add the missing row with an evidence-derived disposition (or an honest, reasoned `Unknown` — the
issue's own AC2 fallback), and make the document state its own tree-coverage count so a future
omission is visible without a cross-file diff.

**Pre-plan evidence gathered this session** (feeds directly into the Task Breakdown below, so the
disposition is not left for the implementer to re-derive from scratch):

- `plugins/blackhole-agent-plugins/` is git-tracked (59 files) and matches `AGENT_PLUGINS_TARGET_DIRS`
  in `scripts/lib/build/paths.ts:39,46`.
- `documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md` (accepted 2026-08-12, the
  design record for issue #484/Target F) is the authoritative source. Its own Assumption Audit
  table carries the row *"No TSC member has shipped agent-plugins install yet"* marked
  `~ Contestable` — i.e. the ADR that created this tree already flags that no consuming client
  exists yet to trace an install against.
- `README.md`'s `### agent-plugins.org (skills-only shell)` stanza (lines 165-172) is the only
  place Target F is documented for a reader, and unlike every other install stanza in that file
  (Cursor `git submodule add`, Claude `/plugin marketplace add`, Codex `codex plugin add`, Gemini
  `ln -s`) it names **no consumer install command at all** — only the maintainer step
  `bun run build # emits the bundle when ... git-tracked`, plus an explicit disclaimer that the
  full campaign harness is not portable under the current spec.
- Repo-wide grep for `agent-plugins.org` turns up build tooling and documentation only — no
  registry-publish step, no `codex plugin add`-style consumer command, nothing an external client
  could point at today.
- Conclusion: unlike the three rows ADR-038 resolved (which all had *some* live client — Claude
  Code, Antigravity's symlink, or Codex's whole-repo git install — to trace against), Target F has
  **no client to trace at all**. The honest, evidence-backed disposition here is `Unknown`, per
  the issue's own AC2 fallback ("an honest `Unknown` with its blocking question named is better
  than a guessed classification") — not a copy of one of the four existing dispositions.
- `scripts/lib/build/paths.ts:35` and `README.md:169`/`documentation/architecture.md:90` all cite
  this tree's design record as "ADR-021" — the actual file is `ADR-025-...md` (an ADR-038-style
  stale numbering label, not a supersession). That mismatch is a pre-existing, separate defect
  outside this issue's scope (not filed here — flagging it would be scope creep on a Quick-track
  doc-completeness fix); the plan below cites the correct `ADR-025` filename and does not touch
  the stale citations in `paths.ts`/`README.md`/`architecture.md`.

## Touch-Paths

- `documentation/audits/build-tree-install-resolution.md`

plus all generated dist trees per `scripts/lib/build/targets.ts` — N/A here (this file is not a
build source under `src/**`; it is a hand-authored analysis doc with no compiled targets).

## Documentation Impact

The sole Touch-Path **is** the documentation artifact itself (a direct edit to an existing
`documentation/audits/` file), so there is no companion/consumer doc one layer removed to
update. Specifically:

- `documentation/architecture.md` and `README.md` already carry correct, current
  `plugins/blackhole-agent-plugins/` rows (verified this session — `documentation/architecture.md:90`,
  `README.md:165-172,215`) — `scripts/checks/tree-registry.check.ts` (`V-TREE-01`) already
  enforces those two against `COMMITTED_TARGET_TREES`, and this issue's own body confirms the
  audit doc is invisible to that check (by design — the issue's Notes section says extending
  `V-TREE-01` to cover this doc "probably answers no"). Neither file needs a change here.
- `documentation/decisions/INDEX.md` is unaffected — no new ADR is created or amended by this
  plan; `ADR-025` is only **cited** (added to the audit doc's `related:` frontmatter list), not
  modified.
- `documentation/INDEX.md`'s existing row for this file needs no path/type/status change (only
  the file's own `last_updated` frontmatter moves) — its summary text remains accurate.

## Codebase Conventions

Not a Standard-track plan, but the diff must match this document's own established conventions
exactly — these are the integration touchpoints a doc-completeness fix must respect:

| Convention | Where established | What the new row must do |
|---|---|---|
| Row-id scheme | Evidence table `#` column: `1a/1b/1c`, `2`, `3`, `4a/4b`, `5`...`10` (sequential, letter-suffixed only when one `paths.ts` id expands to multiple resolution targets) | New row is a single target for a single `paths.ts` id (`agent-plugins`) → next bare sequential id, `11` (no letter suffix needed) |
| Disposition vocabulary | Classification column values in use today: `Load-bearing`, `Redundant for install`, `Maintainer-surface` (ADR-038 D1/D2), `Shipped-unreferenced` (ADR-038 D3) — plus the still-valid `Unknown` category the doc used before ADR-038 closed its original three rows | New row's Classification cell states its value in the same bold-inline style, e.g. `**Unknown**`, followed by an em-dash and a one-sentence reason + named blocking question (mirrors the pre-ADR-038 phrasing for rows 1b/6/8, e.g. row 6's old style: *"needs a real ... install trace ... before calling it load-bearing or redundant"*) |
| Evidence-citation density | Every existing row cites concrete `file:line` / command output, not assertion (e.g. row 8: `scripts/build.ts:661-662` comment, verbatim quote) | New row cites `scripts/lib/build/paths.ts:39,46`, `ADR-025-agent-plugins-skills-only-shell.md`'s Assumption Audit row, and `README.md:165-172`'s install-stanza contrast (see Objective's evidence list above) |
| Classification-summary bucket format | `- **<Disposition> (<count>)**: <tree list, each with row ref and a one-clause reason>` | Reintroduce an `Unknown (1)` bucket in this exact bullet format — but see the required disambiguating note below, since ADR-038's closing paragraph currently states "the three-row gap this audit left open is closed" and a naive reader could mistake the *new* single-row Unknown bucket for a reopening of that closed one |
| Coverage self-report (AC3, new convention this issue introduces) | None exists yet — this is the gap AC3 asks to close | State once, near the Classification summary, the `COMMITTED_TARGET_TREES` id ↔ row mapping table below, and a `8/8` (or literal count) coverage statement |

**`COMMITTED_TARGET_TREES` id → audit-row mapping** (derived directly from
`scripts/lib/build/paths.ts:39-63`; use this to write the coverage-statement row/sentence):

| `paths.ts` id | Resolves to | Audit row(s) |
|---|---|---|
| `skills-registry` | root `skills/`, `agents/`, `references/`, `rules/` | 4b, 5, 10 |
| `cursor` | `.cursor/` | 4a |
| `claude-native` | `.claude/` (`CLAUDE_NATIVE_ROOT`) | 1c |
| `claude-marketplace` | `.claude-plugin/`, `plugins/blackhole-claude/` | 1a, 1b, 3 |
| `codex` | `codex-agents/`, `codex-skills/`, `.codex-plugin/`, `codex-marketplace.json` | 6, 7 |
| `gemini-workspace` | `.agents/build/`, `.gemini-plugin/` | 9, 8 |
| `agent-plugins` | `plugins/blackhole-agent-plugins/` | **none — this issue adds row 11** |
| `gemini-distribution` | `plugins/blackhole/` | 2 |

## Task Breakdown

- [ ] **Red — demonstrate the gap (issue AC4, leg 1)**: Run
  `grep -c agent-plugins documentation/audits/build-tree-install-resolution.md`. — **AC**: command
  output is exactly `0`, quoted verbatim in the completion evidence (reproduces the issue body's
  own repro exactly).
- [ ] **Add Evidence-table row 11 for `plugins/blackhole-agent-plugins/`**: Insert a new row after
  existing row `10`, before the `## Classification summary` heading, following the Codebase
  Conventions table above exactly — tree name, resolving-install-path cell stating "None
  documented — see evidence", the evidence citations listed in the Objective's pre-gathered
  evidence bullets (`paths.ts:39,46`; ADR-025's Assumption Audit "No TSC member has shipped
  agent-plugins install yet" row; README's Target F stanza lacking a consumer install command,
  contrasted with the other seven stanzas that have one), and Classification `**Unknown**` with
  the blocking question named inline (e.g. "no live agent-plugins.org-conformant client exists to
  trace an install against; undetermined until ADR-025's own re-evaluation trigger — a shipped
  TSC-member client plus a portable agent/rule component type — fires"). — **AC**: the doc's
  Evidence table has exactly one row whose `#` column is `11` and whose Tree column contains
  `plugins/blackhole-agent-plugins/`; that row's Classification cell contains the literal string
  `Unknown`.
- [ ] **Update Classification summary**: add an `- **Unknown (1)**: ...` bullet (matching the
  existing bucket-bullet format) naming row 11 and its one-clause reason, placed after the
  existing `Shipped-unreferenced (1)` bullet. Add one sentence immediately before or after this
  new bullet disambiguating it from ADR-038's closed bucket — e.g. "This is a new, single-row
  Unknown distinct from the three ADR-038 already resolved above; it is not a reopening of that
  closed bucket." — **AC**: `## Classification summary` section contains both `Unknown (1)` and a
  sentence containing the substring `ADR-038` adjacent to it that disambiguates the two buckets
  (grep: `grep -A2 'Unknown (1)' documentation/audits/build-tree-install-resolution.md` matches a
  line containing `ADR-038`).
- [ ] **State coverage explicitly (issue AC3)**: add the `COMMITTED_TARGET_TREES` id ↔ row mapping
  table from Codebase Conventions above (or an equivalent prose enumeration covering all 8 ids)
  into the document, plus a literal coverage count sentence, e.g. "`COMMITTED_TARGET_TREES`
  (`scripts/lib/build/paths.ts`) declares 8 tree ids; every one is classified above (8/8)." —
  **AC**: the doc contains the literal substring `8/8` (or `8 of 8` / `all 8`) in the same section
  as the mapping table, and every one of the 8 `paths.ts` id strings (`skills-registry`, `cursor`,
  `claude-native`, `claude-marketplace`, `codex`, `gemini-workspace`, `agent-plugins`,
  `gemini-distribution`) appears verbatim somewhere in that coverage statement or its mapping
  table.
- [ ] **Frontmatter maintenance**: bump `last_updated` to the implementation date; add
  `documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md` to the `related:` list. —
  **AC**: frontmatter `last_updated` equals the date of the implementing commit; `related:` array
  contains `documentation/decisions/ADR-025-agent-plugins-skills-only-shell.md`.
- [ ] **Green — verify the gap is closed (issue AC4, leg 2)**: Re-run
  `grep -c agent-plugins documentation/audits/build-tree-install-resolution.md`. — **AC**: command
  output is a positive integer strictly greater than the red-phase `0`, quoted verbatim alongside
  the red-phase output in the completion evidence.
- [ ] **Verify Integrity**: run `bun run verify` (flock-wrapped per the campaign's resource
  policy: `flock /tmp/blackhole-verify.lock -c 'bun run verify'`, after confirming `free -m`
  MemAvailable and `load1/nproc` clear the resource-frugal gates). — **AC**: `bun run verify`
  exits 0; the doc-governance/doc-health checks it runs (`V-DOC-GOV-02` lifecycle-frontmatter
  completeness, `V-DOC-03` broken internal links, `doc-health.check.ts` structural staleness)
  report zero new findings attributable to `documentation/audits/build-tree-install-resolution.md`;
  full command tail quoted in the completion evidence.

## Sprint Contract

Definition of done for this issue is the per-task AC list above — every task's `**AC**:`
condition holds. There is no task without a narrower AC, so the blanket "all tests/linters pass"
phrasing does not independently apply beyond the `bun run verify` task's own AC.
