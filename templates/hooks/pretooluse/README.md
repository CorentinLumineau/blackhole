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

## Sibling mercure defer (issue #870, health leg issue #969)

blackhole's fork of these two hooks (`validate-bash-command.js`, `validate-file-changes.js`)
runs alongside mercure's own, independently-versioned copy when both plugins are installed
side by side — a user in that state used to run **two** PreToolUse validators, with drifted deny
lists, on every Bash/Write/Edit call. `utils/sibling-plugin-guard.js`'s `shouldDeferToMercure`
runs first, before any pattern is loaded: when (1) a sibling `mercure` plugin is registered in
`~/.claude/plugins/installed_plugins.json`, (2) the calling repo resolves to a real git main
clone, (3) that plugin's preferred candidate install (project-scope preferred over user-scope)
passes a health check — `utils/sibling-plugin-health.js`'s `isPluginHealthy`, added by issue
#969 — and (4) that main clone has no `.blackhole/config.json` — i.e. an interactive,
non-campaign session — blackhole stands down silently and cedes the call entirely to mercure's
own hook, recording a `tier: defer`, `pattern_id: sibling-plugin-defer` event and exiting `0`
with no pattern checks run at all.

**Health-check scope (issue #969) — read this before assuming more than it detects.** The health
check verifies only that the registered install's `hooks.json` still declares a `PreToolUse`
entry whose referenced script exists on disk and is non-empty: the narrower
manifest-declared-but-script-missing layer. It does **not** detect the ADR-030/issue #800
stale-cache class — a script file that exists, is non-empty, and is referenced correctly by an
untouched `hooks.json`, but whose *content* is stale or broken. A plugin cache left stale after a
merged fix (issue #800's own failure mode) still reads as healthy under this check; closing that
gap would need reading or executing the sibling's own code, a strictly worse trade this check
deliberately does not make (see the design note this issue implemented,
`.blackhole/plans/issue-969-design.md`'s turn-19 gate).

The defer record is **human-greppable only**. Triage never ingests it into
`findings-ledger.json` (`scripts/lib/hook-event-triage.ts`'s `TIER_VCODE` map has no `defer`
entry, deliberately), and it carries no V-code — the two are mutually exclusive by construction:
Triage only ever runs inside a campaign session, and a campaign session is exactly the condition
(`.blackhole/config.json` present) that keeps blackhole from ever deferring in the first place.
A fresh reader of this section alone can therefore correctly conclude: the defer record exists
purely so an operator can confirm after the fact that blackhole stood down for a given call, not
so any automated process acts on it.

Any detection ambiguity — an unreadable/malformed `installed_plugins.json`, no git context, no
candidate install row, a failing health check, or an anomalous main-clone resolution failure —
fails closed toward **not** deferring: blackhole's own validators stay active rather than risk
silently ceding containment to a possibly-stale or absent sibling hook.

One follow-up remains logged, out of this mechanism's scope:

- Rotation/cleanup for `.blackhole/hook-events/` in the non-campaign context — issue #970.
