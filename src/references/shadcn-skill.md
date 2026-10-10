# Bundled shadcn/ui skill

Blackhole ships the official [shadcn/ui skill](https://ui.shadcn.com/docs/skills)
next to this skill, vendored at `vendor/shadcn/` (pinned commit in
`vendor/shadcn/upstream.json`). Every plugin install receives it automatically.

{{#cursor}}
Bundled path: `.cursor/skills/shadcn/SKILL.md`
{{/cursor}}
{{#claude}}
Bundled path: `{{AGENT_DIR}}/skills/shadcn/SKILL.md`
{{/claude}}
{{#gemini}}
Bundled path: `{{AGENT_DIR}}/skills/shadcn/SKILL.md`
{{/gemini}}
{{#skills}}
Bundled path: `skills/shadcn/SKILL.md`
{{/skills}}
{{#codex}}
Bundled path: `codex-skills/shadcn/SKILL.md`
{{/codex}}

## When to load it

Load and follow the bundled skill when **both** are true:

1. The work is UI or design-system work (`route.ui: true`, a frontend-touching
   diff, or the user asked to add/compose/restyle shadcn components).
2. The target repo has a `components.json` (the skill's own activation signal).

If `components.json` is absent, do not load the skill and do not run `shadcn`
CLI commands. This wrapper is inert on non-shadcn projects.

## Authority

The consumer project's own design sources beat shadcn defaults:

1. **`DESIGN.md`** (tokens, themes, display targets, do/don'ts) — authoritative
   for visual language. Cite `V-ADA-03` / `V-ADA-04` when it is missing or stale.
2. **`design-rubric.md`** (`{{AGENT_DIR}}/skills/blackhole/references/design-rubric.md`)
   — authoritative for Design Track scoring axes. Do not replace those columns
   with shadcn style-picker heuristics.
3. The bundled skill — authoritative for component APIs, composition, and CLI
   *mechanics* (`add`, `search`, `docs`, `info`, `diff`).

When DESIGN.md and a shadcn default disagree, keep DESIGN.md. Record the
divergence; do not "fix" the project to match a preset.

## Owner-gated CLI (never silent)

The upstream skill documents `apply`, `init --preset`, and preset/theme
switches. **Do not run those without the owner's explicit OK:**

- `npx/pnpm dlx/bunx shadcn apply` (any preset code or `--only theme|font`)
- `shadcn init --preset` / `init --defaults` / `init --base … --preset …`
- Changing `components.json` `style`, `preset`, or theme tokens to match a
  preset the owner did not name

"Explicit OK" means an owner message in this session, an issue/PR comment, or
an approved `ui_gate` / design-approval resume — not inference from DESIGN.md
or from the skill's "pick the closest style" table.

Without that OK: do **not** run the command. Ask (`AskQuestion`) or return
`status: blocked` with a one-line reason naming the command you refused.
`add` / `search` / `docs` / `info` / `diff` / `--dry-run` stay allowed.

Upstream `design-system.md` Step 1 (`init --preset` / style pick) is the same
gate: stop before scaffolding or restyling a live project until the owner
confirms the preset or style.
