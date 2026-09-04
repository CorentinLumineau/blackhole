---
type: plan
summary: "Bugfix plan for V-CONFIG-02 nested-block leaf coverage — parent-row `(sub-keys: ...)` marker convention for `router_confidence_thresholds`"
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# Plan - Issue #707

## Objective

Fix `V-CONFIG-02`'s coverage gap for nested config blocks that are documented as a single
parent-block row instead of one row per leaf, so a config carrying `router_confidence_thresholds`
passes registration checking. This is item R-04 of
`documentation/plans/plan-retrospective-v0.21.0-remediation.md`.

**Root cause.** `flattenConfigKeys` (`scripts/checks/config-registration.check.ts`) recursively
flattens nested objects into dot-path leaf keys (`router_confidence_thresholds.split`,
`.design`, …). `parseConfigTemplateKeys` only registers a key when it finds a literal `Field`
column entry in `src/references/config-template.md`'s table. For `docs_governance`, `kaizen`,
`incident_mode`, and `autonomy`, the template already carries one row per leaf (e.g.
`docs_governance.enabled`), so those blocks' flattened keys match one-to-one. `config-template.md:47`
documents `router_confidence_thresholds` as a **single parent row** whose Description prose lists
the leaf names in English ("keyed by `split`, `design`, …") — never as individual `Field` rows.
`findUnregisteredConfigKeys` therefore reports every `router_confidence_thresholds.*` leaf as
unregistered even though the block **is** documented, just not in a shape the parser can see.

**Live-failure verification.** `.blackhole/config.json` at the plan's base commit does **not**
contain `router_confidence_thresholds` at all — `bun run verify` passes `V-CONFIG-02` on this
repo's current committed config, contrary to the issue evidence's framing ("`bun run verify`
fails … when `.blackhole/config.json` is present"). `fixtures/config.example.json` also omits the
block, so it already passes trivially. The defect is real but **latent**: it fires the moment any
config (committed or a campaign's own) sets the documented `router_confidence_thresholds` field,
which is a legitimate, already-documented field — not a hypothetical.

**Approach decision.** Two approaches satisfy the AC: (a) teach the check to treat a documented
parent row that names its sub-keys as covering them, or (b) add one `Field` row per leaf to
`config-template.md` (mirroring `docs_governance`/`kaizen`). **Chosen: (a).** Rationale: R-16
(`#723`, blocked on this issue) is about to add a `resolution:` sentence "per nested block row"
to `config-template.md` — i.e. it treats each nested block's **single row** as the canonical SSOT
anchor for that block's gating semantics. Adding 8 new per-leaf rows for
`router_confidence_thresholds` (approach b) would leave R-16 with an ambiguous target and would
not fix the underlying defect class — a future nested block documented only in prose would
reproduce the same gap. Approach (a) fixes the general case: any nested block may be documented
as a single row carrying a machine-parseable `(sub-keys: a, b, c)` marker in its Description
cell, and the check registers `<parent>.<leaf>` for each named leaf.
`docs_governance`/`kaizen`/`incident_mode`/`autonomy` are unaffected (their leaves already have
individual rows) and are not touched by this plan.

## Touch-Paths
- `scripts/checks/config-registration.check.ts`
- `scripts/verify.config-registration.test.ts`
- `src/references/config-template.md` plus all generated dist trees per `scripts/lib/build/targets.ts`

## Task Steps

1. Add failing tests to `scripts/verify.config-registration.test.ts`: `parseConfigTemplateKeys`
   recognizes a `(sub-keys: a, b)` marker; `findUnregisteredConfigKeys` still flags a leaf not
   named in the marker; a live-tree integration test proves the fix against the real
   `config-template.md` content plus a synthesized `router_confidence_thresholds` object carrying
   all 8 documented sub-keys.
2. Extend `parseConfigTemplateKeys` (`scripts/checks/config-registration.check.ts`) to parse the
   `(sub-keys: a, b, c)` marker from a row's Description cell and register `<Field>.<leaf>` for
   each named leaf; document the convention in a header comment.
3. Append `(sub-keys: split, design, plan_mode, security, docs, brainstorm, analysis, ui)` to the
   `router_confidence_thresholds` row's Description cell in `src/references/config-template.md`.
4. Run `bun run build` to regenerate mirrored dist trees; verify `bun test
   scripts/verify.config-registration.test.ts` and `bun run verify` are both green.

## Rollback
Revert the three-file diff (check, test, template) plus the `bun run build` regeneration; no
schema, data, or state migration is introduced.
