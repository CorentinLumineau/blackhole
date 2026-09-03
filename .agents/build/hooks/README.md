# PreToolUse Hooks — Installed Cache Refresh (issue #800, ADR-030)

The files in this directory (`hooks.json`, `validate-bash-command.js`,
`validate-file-changes.js`, `patterns/`, `utils/`) are the source for the PreToolUse guards that
enforce safety checks (worktree-removal guard, destructive Bash pattern denial, sensitive-file
write denial, etc.) during a live Claude Code session.

## The cache is version-keyed, not content-addressed

When a user installs blackhole as a Claude Code plugin
(`/plugin marketplace add ...` + `/plugin install blackhole@blackhole-marketplace`), Claude Code
copies this directory's built output into
`~/.claude/plugins/cache/blackhole-marketplace/blackhole/<version>/hooks/` and **that installed
copy — not this repo's checkout — is what actually runs** during a session.

Claude Code's plugin cache keys on the `version` string in `.claude-plugin/plugin.json`, not on
the content of the files themselves. Editing and merging a fix to any file in this directory does
**nothing** for an existing installation unless the plugin's version also changes: the cache
directory for the already-installed version is never revisited, so the old (unpatched) copy keeps
running indefinitely. This is exactly the incident #800 documents: three merged security fixes to
`utils/worktree-removal-guard.js` (#761, #774, #777) shipped inert to every existing installation
for weeks — both the installed copy and this repo's build reported the identical version string,
so nothing signaled the divergence.

## Refresh path

1. Bump `package.json`'s `version` field (a plain patch/minor bump is enough — this is a version
   *change*, not a semantic-versioning judgment call for this purpose).
2. Run `bun run build` — this regenerates all 5 version-carrying manifests from
   `package.json`'s version, `.claude-plugin/plugin.json` included, with no separate tooling
   needed (`scripts/release.ts`'s `prepareRelease`).
3. `/plugin marketplace update <name>` inside Claude Code, then reinstall the plugin.

Same-version reinstall's cache-refresh semantics (whether it forces a fresh fetch or no-ops
against the existing cache directory) are not documented by the platform — see
`.blackhole/plans/issue-800-research.md` § Assumption Audit. **When in doubt, skip that
ambiguity and use the documented unconditional fallback instead**:

```bash
rm -rf ~/.claude/plugins/cache
```

then restart Claude Code and reinstall the plugin from scratch.

## Enforcement

Every PR that touches a file under `templates/hooks/**` must also bump `package.json`'s
`version` field in the same diff — enforced as a `BLOCK`-severity reviewer gate, `V-PLUGIN-01`
(`src/agents/reviewer.md` § 29, `src/references/blackhole-vcodes.md`). An independent, advisory
session-start signal (`.blackhole/plugin-drift.json`, `blackhole-state.md` § Plugin-Drift Signal)
covers the residual gap this gate cannot see: a PR correctly bumps the version, but nobody ever
runs the refresh path above afterward.
