## Bundled shadcn skill (conditional)

**Detection**: the issue is UI or design-system work (`route.ui` from
`<PLAN_CONTEXT>`, or the frontend-detection keyword SSOT cited by
`reviewer.md` § Companion-File Audit) **and** the worktree has a
`components.json`. Neither signal — skip this subsection.

**Load**: read `{{AGENT_DIR}}/skills/blackhole/references/shadcn-skill.md`, then
the bundled skill it names. Follow that wrapper: `DESIGN.md` and
`design-rubric.md` stay authoritative; never run `shadcn apply` or
`init --preset`, and never change a theme or preset, without the owner's
explicit OK.

**Allowed without a new gate**: `add`, `search`, `docs`, `info`, `diff`,
`--dry-run` on an already-initialized project.

---
