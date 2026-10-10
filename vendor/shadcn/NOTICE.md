# Vendored shadcn/ui skill

This directory is a **verbatim** copy of the official shadcn/ui skill from
[`shadcn-ui/ui`](https://github.com/shadcn-ui/ui) at the commit pinned in
`upstream.json`. It is MIT-licensed; see `LICENSE.md`.

Upstream: https://github.com/shadcn-ui/ui/tree/main/skills/shadcn  
Docs: https://ui.shadcn.com/docs/skills

`evals/` is omitted (upstream test fixtures, not required at runtime).

Do not hand-edit files under `skill/`. Re-sync from the pin instead.

## Re-sync

Same shape as the mercure V-code snapshot (`scripts/lib/mercure-vcode-snapshot.ts`):
a maintainer runs a dedicated script; `bun run verify` never fetches upstream.

```bash
# Refresh to the commit already in upstream.json
bun run sync:shadcn

# Pin a new commit, then rebuild so plugin trees pick it up
bun run sync:shadcn -- --commit <40-char-sha>
bun run build
```

The script overwrites `skill/`, `LICENSE.md`, and `upstream.json`. Blackhole
policy that wraps this skill lives in `src/references/shadcn-skill.md`, not here.
