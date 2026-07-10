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
