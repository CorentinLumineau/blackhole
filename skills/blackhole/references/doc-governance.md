---
description: campaign writes to consumer-repo documentation/ — search-before-write, canonical naming, lifecycle frontmatter, supersede-on-overwrite
globs: ["documentation/**"]
alwaysApply: false
---

# Doc Governance

Gated by `docs_governance.write_governance`: inert when `docs_governance.enabled` does
not resolve to `true` (per `config-template.md` § `docs_governance` resolution — this whole
file is inert) or `docs_governance.write_governance === false`. Every obligation below is
advisory (`V-DOC-GOV-01..04`) — see `blackhole-vcodes.md` for enforcement weight.

## Search-Before-Write

Before creating a new file under a consumer repo's `documentation/` tree: grep the target
folder (and `documentation/INDEX.md` if present) for an existing doc covering the same
concern. If a match exists, update it in place — do not create a new file (`V-DOC-GOV-01`).

## Canonical Naming

One file per concern, named `{concern-slug}.md` — never date-stamped. Slug derivation SSOT:
`scripts/lib/concern-slug.ts` (`deriveConcernSlug`, `planTargetPath`, `reviewTargetPath`). Two
exemptions keep a filename prefix ahead of `{concern-slug}.md`: ADR files, which keep their
sequential identifier (`ADR-{NNN}-{slug}.md`), and durable research notes under
`documentation/investigations/`, which keep the `research-` prefix
(`research-{concern-slug}.md`, ADR-033) to stay distinguishable from `investigate` route notes
sharing the same folder. A filename with a `-YYYY-MM-DD` suffix is the trigger condition for
`V-DOC-GOV-03`.

## Lifecycle Frontmatter

Every doc under `documentation/` carries this frontmatter:

```yaml
---
type: brainstorm | research | adr | analysis | plan | reference | implementation | review | runbook
summary: "One-line summary — the same text as this doc's documentation/INDEX.md row"
status: current | deprecated | archived
supersedes: <path>          # optional — only when replacing an earlier doc
review_trigger: "on ADR acceptance" | "on release" | "quarterly" | "on file change" | "on rule update"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
related: [<path>, ...]      # optional
---
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | Yes | Drives folder placement and search heuristics |
| `summary` | Yes | One-line summary, JSON-quoted (same convention as `review_trigger` below) — ADR-031 Phase 1 (issue #811): the doc's own copy of its `documentation/INDEX.md` row summary, source-derived for `scripts/generate-doc-index.ts` |
| `status` | Yes | `current` = live; `deprecated` = superseded but kept for traceability; `archived` = historical only |
| `supersedes` | Conditional | Required when replacing an existing doc's content with a different approach |
| `review_trigger` | Yes | What event obliges a re-read; agents use this when touching related code |
| `created` / `last_updated` | Yes | ISO dates; `last_updated` mirrors meaningful content edits, not whitespace |
| `related` | No | Cross-references for graph navigation |

All six lifecycle keys (`type`, `summary`, `status`, `review_trigger`, `created`,
`last_updated`) are required — any absence is `V-DOC-GOV-02` (Phase 1 does not yet wire
`summary`'s presence into that check's enforcement; see Phase 2 notes at
`documentation/plans/plan-documentation-index-generation-implementation.md`). `supersedes` and
`related` remain optional.

An instantiated companion-file template — currently only `documentation/reference/journeys.md`
(`templates/companion-files/journeys.md.template`) — may carry `status: template` instead of
one of the four values listed above. This is already accepted, not a new exception granted
here: `doc-health.check.ts`'s `V-DOC-GOV-02` check (`findMissingFrontmatter` /
`lifecycleFrontmatterComplete`) only checks the `status` key's **presence**, never its value
against an enum, so `status: template` has always passed. This is a scoped, one-off exception
for companion-file templates only, not a general loosening of the `status` enum: the value
signals the file is unfilled placeholder content, and the owning hunt-kind band (`ux-coherence`)
is the one consumer that treats it as not-yet-ground-truth (`templates/companion-files/README.md`
§ `journeys.md` hunt-kind gate).

## Supersede-on-Overwrite

When a diff substantively replaces a doc's content with a different approach (not a minor
update to the same approach): mark the old doc `status: deprecated` and leave it in place —
never delete it — then create or update the new doc with `supersedes: <path-to-old-doc>` in
its frontmatter. Skipping this on a substantive replacement is `V-DOC-GOV-04`.

**Archival terminus (curate-equivalent)**: both docs remain indexed while the old doc is
`status: deprecated`. When `last_updated` on a deprecated doc exceeds the deprecation window
in `DOC_HEALTH_THRESHOLDS` (`scripts/lib/build/facts.ts`, currently 90 days — issue #442),
transition it to `status: archived`, update its root `documentation/INDEX.md` row to match, and
move the file under `documentation/milestones/_archived/` (preserving its concern slug).
Deprecated docs that never cross the window stay in place — archival is a deliberate curate
step, not an automatic delete.

## ADR Status Enum

`documentation/decisions/ADR-*.md` files use a dedicated status enum instead of the generic
`current | deprecated | archived` schema declared above:
`status ∈ {accepted, superseded, deprecated}`. This preserves the plurality-observed spelling
and the industry-standard ADR lifecycle term ("accepted" signals a decision was actively made)
— see
`.blackhole/plans/issue-324.md`'s Design Decision for the full rationale and rejected
alternative.

The enum is enforced across three surfaces, each with a different tolerance for the value's
shape:

- **Frontmatter `status:`** — a bare enum token, exact case (`V-ADR-01`).
- **`documentation/decisions/INDEX.md`'s `status` column** — a bare enum token, exact case,
  equal to the file's frontmatter value (`V-ADR-02`).
- **An in-body `## Status` section** — optional (present on a subset of ADRs); when present,
  it carries human prose evidence (e.g. "Accepted — 2026-07-21 (shipped in v0.15.0: ...)") that
  must never be flattened to a bare token. Only its **leading token** is checked, and only for
  agreement with frontmatter, case-insensitively (`V-ADR-03`). Absence of the section is not a
  failure.

Enforced by `scripts/checks/adr-status.check.ts`.

## Doc-Tree Health Signal

Scope split (ADR-021 D6): this section is the **Scope-1** enforcer — blackhole's own
`documentation/` tree, checked unconditionally by `bun run verify`
(`scripts/checks/doc-health.check.ts`) and **not** gated by `docs_governance.write_governance`
(the everything-else in this file governs Scope 2 — writes the campaign makes into a *consumer*
repo's `documentation/` tree, which is gated). **Scope-2** enforcement — the reviewer judgment
audit for consumer-repo trees (supersession-chain coherence, `V-DOC-GOV-01..04`) — is the sibling
section `reviewer.md` §27 (Doc-Governance Judgment Audit), not implemented by this section.

Four thresholds, numeric values declared once in `scripts/lib/build/facts.ts`'s
`DOC_HEALTH_THRESHOLDS` export (Numeric-fact SSOT — never restated as an inline literal in the
check or here without citing that export):

- A single doc past the **400-line single-doc ceiling** is oversized. `INDEX.md` files are
  exempt — they have their own row ceiling below instead.
- The root `documentation/INDEX.md` past the **200-row root-INDEX ceiling** means the entry
  point costs more to read than the answer it points to.
- The tree past the **500-file tree-size advisory** is a signal only — a large tree that is
  well-tiered into per-folder indexes is still healthy.
- A doc marked `status: deprecated` whose `last_updated` exceeds the **90-day deprecation window**
  is a candidate for archival.

All four are advisory (`ok: true` always, per `V-DOCHEALTH-03`) — mirrors mercure's own framing
for this exact signal, which likewise has no CI-blocking equivalent, surfacing instead through a
session-start hook rather than a hard gate.

A fifth field, `decision_log_silent_prs` (issue #717, R-12), counts merged `queue.json` issues
whose PR number never appears in `documentation/reference/decision-log.md`'s Records table —
the signal a hand-appended, never-bumped log gave no way to notice. Same advisory-only framing
as `doc_debt` (`blackhole-state.md` § Doc-Health Signal, not restated here — V-DRY-01).

### Always-On Channel (issue #499)

Determination: **Reading 2 (a real gap), verified.** Before this landed, nothing read this
signal anywhere — `doc-health.check.ts` (PR #494 / issue #462) delivered detection, but no
agent prompt or protocol step consumed it, at turn start or otherwise.

The fix is not a literal port of mercure's `SessionStart` hook: blackhole's orchestrator is one
continuous session looped across many turns, not mercure's per-invocation Claude Code CLI
session, so a `SessionStart` hook would fire once per orchestrator *session* rather than once
per *turn* — under-delivering the "every phase sees documentation debt" guarantee the signal
exists for. Instead, `blackhole-state.md` § Doc-Health Signal wires the refresh into the same
per-turn cadence § Sync already uses for forge reconciliation — a markdown-instructed protocol
step, not a Claude-Code-native hook, achieving the equivalent cadence with a primitive this repo
already has.

Scope boundary restated in one sentence: this channel only ever refreshes blackhole's own
Scope-1 `documentation/` tree; Scope-2 (a consumer repo's tree) is enforced at review time by
`reviewer.md` §27 (Doc-Governance Judgment Audit).

## INDEX.md Maintenance

The root `documentation/INDEX.md` is a single-file index of every live doc in blackhole's own
tree, in the same 5-column schema documentation/decisions/INDEX.md already uses in production:

```markdown
| path | summary | type | status | review_trigger |
|------|---------|------|--------|----------------|
| audits/foo.md | One-line summary | audit | current | on release |
```

Row `path` values are **relative to `documentation/`** (e.g. `decisions/ADR-021-....md`,
`audits/foo.md`) — distinct from `documentation/decisions/INDEX.md`'s own convention of bare
filenames relative to its own directory (a per-folder index, unambiguous within one folder
alone; the root index spans many folders and needs the folder-prefixed form).

**Row order (issue #743)**: both `documentation/INDEX.md` and `documentation/decisions/INDEX.md`
insert rows in path-sorted order, not append/chronological order — the shared
`appendIndexRowIfAbsent` primitive (`scripts/lib/check-common.ts`) rebuilds the row block as
`[...existingRows, newRow].sort((a, b) => a.path.localeCompare(b.path))` on every insert, so
concurrent carry/promotion PRs touching the same file land their new rows at different offsets
instead of the same anchor line. Since ADR filenames are zero-padded to a fixed 3-digit width,
path order and ADR-sequence order coincide for the decisions index — no separate ordering rule
is needed for that file.

Owning agent: **`implementer`** — no new agent is minted for this obligation; it reuses
`implementer`'s existing ADR-021 D2 carry-step role (the mechanism that already writes
staged/derived documentation artifacts into the tree). Every doc under `documentation/` needs a
corresponding row (`V-DOCHEALTH-02`, blocking), and every row needs to resolve to a file that
still exists (`V-DOCHEALTH-01`, blocking) — both enforced unconditionally by
`scripts/checks/doc-health.check.ts` regardless of `docs_governance.write_governance`, per the
Scope-1/Scope-2 split above.

This obligation is stated as rule text only as of this section landing — the carry-step's actual
INDEX-upsert wiring for artifacts staged outside the ADR/design route (e.g. `investigator`'s
`analyze`/`investigate` sub-modes) is a residual gap tracked as a fast-follow, not yet closed by
any agent's numbered steps.

## Repo Convention Precedence

When the target consumer repo already documents its own frontmatter/lifecycle convention for
`documentation/` (e.g. its own `CONTRIBUTING.md`, `documentation/README.md`, or a rule file),
follow that repo's convention instead of imposing the default schema above (`V-INT-01`). The
four-field default schema in this rule applies only when no repo-specific convention is
discoverable.

Precedence detection covers **both** artifact layers a consumer repo may already have adopted
mercure's own conventions for: `documentation/decisions/INDEX.md`'s table header, and an ADR
file's frontmatter block. The comparison logic — column lists, discriminator keys, and
normalization rules — is not restated here; `scripts/detect-doc-schema.sh` is the SSOT (cited
as cross-reference, not invoked by prose-only consumers of this rule, same pattern as
`scripts/detect-frontend.sh` in `reviewer.md`'s V-ADA-04 keyword SSOT).

Three-outcome contract, per artifact layer:

- **File/ADR absent**: fall back to blackhole's own schema. No `V-INT-01` — there is nothing
  to diverge from yet.
- **`schema=mercure` or `schema=blackhole`**: the detected schema wins — emit in that schema,
  matching the repo's existing convention exactly.
- **`schema=ambiguous`**: fall back to blackhole's own schema **and** emit a `V-INT-01` WARN
  citing the offending `file:line` (the malformed/partial header or frontmatter block that
  produced the ambiguous result) — the misfire must be visible, never silent (ADR-012 R6).
<!-- GENERATED by scripts/build.ts from src/references/doc-governance.md — do not hand-edit -->
