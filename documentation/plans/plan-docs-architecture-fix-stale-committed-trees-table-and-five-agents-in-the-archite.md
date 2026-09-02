---
type: plan
status: current
review_trigger: "on release"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
  - documentation/audits/build-tree-install-resolution.md
  - documentation/decisions/ADR-009-claude-marketplace-bundle-isolation.md
---

# Plan - Issue #706

## Objective
Fix two stale architecture-map facts flagged by the v0.21.0 retrospective remediation plan
(item R-03, child of epic #703). `documentation/architecture.md` § Committed target trees still
maps `.claude/` + `.claude-plugin/` as one combined "Claude Code plugin + marketplace manifest"
row — the pre-ADR-009 shape — and has no row for `plugins/blackhole-claude/`, the bundle
`.claude-plugin/marketplace.json`'s `source` has actually pointed at since ADR-009 (issue #262).
`ARCHITECTURE.md` §3.2 says "Five markdown-defined agents" while `AGENT_NAMES`
(`scripts/lib/build/facts.ts:13`) lists eight: `coordinator`, `orchestrator`, `planner`,
`implementer`, `reviewer`, `router`, `investigator`, `hunter`. Both target files are
hand-authored companion docs at the repo root/`documentation/` — neither is under `src/**`, so
this is a direct in-place edit with no `bun run build` regeneration step. Out of scope (per the
issue body): any decision to add, remove, or reclassify a committed build tree — that is a
separate item (R-18), gated on its own ADR.

## Touch-Paths
- `documentation/architecture.md`
- `ARCHITECTURE.md`

## Documentation Impact
None beyond the Touch-Paths themselves — both edited files *are* the documentation being
corrected, not a Touch-Path with a separate downstream consumer doc. The one doc that already
discusses this exact staleness, `documentation/audits/build-tree-install-resolution.md`
(2026-07-24), explicitly flagged it as "not fixed here" and deferred it to "a future
`documentation/architecture.md` edit" — this plan is that follow-up, and the audit needs no
change since it never asserted the stale mapping was current, only that it existed uncorrected.
No other companion/consumer doc references the specific claims being corrected here.

## Task Breakdown
- [ ] **Fix `documentation/architecture.md` § Committed target trees**: split the single stale
  row that maps `.claude/` + `.claude-plugin/` (`plugin.json`, `marketplace.json`) →
  "Claude Code plugin + marketplace manifest" into two rows: (a) `.claude/` (repo root:
  `agents/`, `rules/`, `skills/blackhole/`) whose Consumer column states "maintainer-local, not
  an install path (ADR-009)" — auto-discovered only when this repo itself is opened in Claude
  Code, never redistributed; (b) `.claude-plugin/` (`plugin.json`, `marketplace.json`) +
  `plugins/blackhole-claude/` whose Consumer column describes the Claude Code marketplace
  install (`/plugin marketplace add` + `/plugin install`) and notes that `marketplace.json`'s
  `source` resolves to `plugins/blackhole-claude/`, the isolated bundle that ships `agents/`
  (ADR-009). Leave the other 6 rows (skills.sh flat registry, `.cursor/`, Codex, Gemini
  workspace, `plugins/blackhole/`, `plugins/blackhole-agent-plugins/`) unchanged — cross-check
  every row's tree list against `scripts/lib/build/paths.ts`'s named constants
  (`CLAUDE_NATIVE_ROOT`, `CLAUDE_DISTRIBUTION_ROOT`, `DISTRIBUTION_ROOT`, `AGENTS_BUILD_ROOT`,
  `AGENT_PLUGINS_DISTRIBUTION_ROOT`, `CODEX_TARGET_DIRS`) and README § Installation Paths so no
  tracked tree ends up missing or duplicated. Bump the file's `last_updated` frontmatter field to
  the date this PR lands. —
  **AC**: `grep -n "maintainer-local, not an install path (ADR-009)" documentation/architecture.md`
  matches exactly one table row; `grep -n "plugins/blackhole-claude" documentation/architecture.md`
  matches; `grep -c '^| \`' documentation/architecture.md` returns `8` (one row per tree grouping
  in `paths.ts` plus the pre-existing flat skills.sh/`.cursor` groupings).
- [ ] **Fix `ARCHITECTURE.md` §3.2 (and its §1 cross-reference)**: replace §3.2's "Five
  markdown-defined agents ... coordinator ... orchestrator ... planner ... implementer ...
  reviewer" sentence with all eight names from `AGENT_NAMES` (`scripts/lib/build/facts.ts:13`) —
  `coordinator`, `orchestrator`, `router`, `planner`, `implementer`, `reviewer`, `investigator`,
  `hunter` — each with a short role phrase sourced from `AGENTS.md`'s roster table (`router` =
  issue classification into the `route{}` object, ADR-004; `investigator` = evidence-gathering
  for router re-route checkpoints; `hunter` = read-only kaizen improvement scanner, ADR-006) so
  wording stays consistent with the canonical roster doc rather than re-deriving new phrasing.
  Also update §1 Project Structure's `src/agents/` inline comment (currently lists only 5 of the
  8 filenames) to the full 8-name list, so the two sections do not contradict each other after
  this edit. —
  **AC**: `grep -n "Eight markdown-defined agents" ARCHITECTURE.md` matches;
  `grep -n "Five markdown-defined agents" ARCHITECTURE.md` returns no match;
  `grep -n '`router`' ARCHITECTURE.md`, `grep -n '`investigator`' ARCHITECTURE.md`, and
  `grep -n '`hunter`' ARCHITECTURE.md` each match within the §3.2 paragraph;
  `sed -n '25p' ARCHITECTURE.md` (the `src/agents/` comment line under §1) lists all 8 agent
  names.
- [ ] **Link-integrity regression**: confirm neither edit introduced a dead markdown link or ADR
  cross-reference error (`V-LINK-01`, `scripts/checks/links.check.ts`) — no unit test applies to
  a prose-only doc fix, so this check is the verification step for both tasks above. —
  **AC**: `bun run verify 2>&1 | grep 'V-LINK-01'` prints `✓ V-LINK-01` with no `✗` and no
  detail suffix.

## Sprint Contract
Definition of done is the three per-task ACs above: both stale-fact corrections are present and
grep-verifiable in their target files, and `bun run verify` reports `V-LINK-01` passing with no
regression. No task in this plan has a narrower "all tests and linters pass" fallback — a
prose-only fix has no test suite to run beyond the link-integrity check already stated.
