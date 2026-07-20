---
description: campaign writes to consumer-repo documentation/ — search-before-write, canonical naming, lifecycle frontmatter, supersede-on-overwrite
globs: ["documentation/**"]
alwaysApply: false
---

# Doc Governance

Gated by `docs_governance.write_governance`: inert when `.blackhole/config.json`
`docs_governance.enabled === false` or `docs_governance.write_governance === false`. Every
obligation below is advisory (`V-DOC-GOV-01..04`) — see `blackhole-vcodes.md` for enforcement
weight.

## Search-Before-Write

Before creating a new file under a consumer repo's `documentation/` tree: grep the target
folder (and `documentation/INDEX.md` if present) for an existing doc covering the same
concern. If a match exists, update it in place — do not create a new file (`V-DOC-GOV-01`).

## Canonical Naming

One file per concern, named `{concern-slug}.md` — never date-stamped. The sole exemption is
ADR files, which keep their sequential identifier: `ADR-{NNN}-{slug}.md`. A filename with a
`-YYYY-MM-DD` suffix is the trigger condition for `V-DOC-GOV-03`.

## Lifecycle Frontmatter

Every doc under `documentation/` carries this frontmatter:

```yaml
---
type: brainstorm | research | adr | analysis | plan | reference | implementation | review | runbook
status: current | deprecated | archived
supersedes: <path>          # optional — only when replacing an earlier doc
review_trigger: "on ADR acceptance" | "on release" | "quarterly" | "on file change" | "on rule update"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
related: [<path>, ...]      # optional
---
```

`type` and `status` are required (their absence is `V-DOC-GOV-02`); `supersedes` and
`related` are optional.

## Supersede-on-Overwrite

When a diff substantively replaces a doc's content with a different approach (not a minor
update to the same approach): mark the old doc `status: deprecated` and leave it in place —
never delete it — then create or update the new doc with `supersedes: <path-to-old-doc>` in
its frontmatter. Skipping this on a substantive replacement is `V-DOC-GOV-04`.

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
