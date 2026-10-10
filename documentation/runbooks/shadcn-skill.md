---
type: runbook
summary: "Blackhole vendors the official shadcn/ui skill at a pinned commit and loads it for UI work when components.json exists"
status: current
review_trigger: "on file change"
created: 2026-10-10
last_updated: 2026-10-10
---

# Bundled shadcn/ui skill

Every Blackhole plugin install includes the official
[shadcn/ui skill](https://ui.shadcn.com/docs/skills) (`SKILL.md` plus references
such as `cli.md`). Source of truth is `vendor/shadcn/` at the commit in
`upstream.json`. `bun run build` copies it into each plugin `skills/shadcn/`
tree (Codex: `codex-skills/shadcn/`).

## Campaign wiring

When a consumer repo has `components.json` and the issue is UI or design-system
work, planner / implementer / reviewer follow
`src/references/shadcn-skill.md`:

- Load the bundled skill for component APIs, composition, and CLI mechanics.
- Keep the project's `DESIGN.md` and Blackhole's `design-rubric.md` authoritative.
- Never run `shadcn apply` or `init --preset`, or change a theme or preset,
  without the owner's explicit OK.

## Re-sync

```bash
bun run sync:shadcn
bun run sync:shadcn -- --commit <40-char-sha>
bun run build
```

Full maintainer notes: `vendor/shadcn/NOTICE.md`.
