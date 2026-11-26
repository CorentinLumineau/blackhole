# PreToolUse Hooks — Installed Cache Refresh (issue #800, ADR-030)

The files in this directory (`hooks.json`, `validate-bash-command.js`,
`validate-file-changes.js`, `patterns/`, `utils/`) are the source for the PreToolUse guards that
enforce safety checks (destructive Bash pattern denial, sensitive-file
write denial, etc.) during a live Claude Code session. Each PreToolUse command hook in
`hooks.json` sets `"onFailure": "block"` (Claude Code ≥2.1.295) so a missing `bun`, a crash, or
the 15-second timeout refuses the tool call instead of failing open.

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
the since-removed worktree-removal guard (#761, #774, #777) shipped inert to every existing installation
for weeks — both the installed copy and this repo's build reported the identical version string,
so nothing signaled the divergence.

## Refresh path

1. Bump `package.json`'s `version` field (a plain patch/minor bump is enough — this is a version
   *change*, not a semantic-versioning judgment call for this purpose).
2. Run `bun run build` — this regenerates every version-carrying manifest listed in
   `VERSIONED_MANIFESTS` (`scripts/lib/build/manifests.ts`) from
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

## Campaign scope (ADR-047)

Worktree write containment and the main-clone git guard only constrain campaign workers
(`utils/campaign-scope.js`): a call whose `agent_type` names a blackhole agent, a call with an
assigned worktree (declared or cwd-derived), or any call when `BLACKHOLE_HOOK_SCOPE=all` is set.
An ordinary session that happens to load the plugin is left alone by those two guards. Every
other guard (destructive patterns, sensitive files, system paths, traversal,
Bash write targets) applies to every call.

## Campaign state dir trust

For campaign-scoped callers, both write guards (`validate-file-changes.js` and the Bash write
guard) treat the main clone's `.blackhole/` as a second allowed root, so workers can write
`plans/`, `staged/<issue>/`, `queue.json`, `findings-ledger.json` and their `.tmp` files from a
linked worktree. The root (`campaignStateRoot` in `utils/hook-event-log.js`) exists only when the
anchored main clone resolves, `.blackhole/config.json` exists, and the realpath is not a broad
directory; it is derived from the main clone, so a link planted inside a worktree cannot mint it.

**Main-clone anchor.** The campaign config, the state dir, the configured `scratchpad_dir` and the
sibling-plugin defer are read from the main clone `anchoredMainClone(cwd)` returns. A worker can
rewrite the git metadata in `cwd` (its worktree's `.git` pointer, a planted `.git`, a nested
repository), so on its own that metadata is only a claim, and the anchor is the harness project dir
(`CLAUDE_PROJECT_DIR`, accepted by `isHarnessProjectDir`):

- **Anchor established** (the project dir is absolute, existing, not a linked worktree, not inside
  the worker's worktree or scratchpad, and belongs to a main clone): the clone the git metadata in
  `cwd` names is trusted only when it is that same clone. A disagreement is a forged clone, and those
  four sources then grant nothing; the payload `scratchpad_dir`, `BLACKHOLE_SCRATCHPAD_DIR` and the
  user settings keep working. The deny record still goes to the project dir's `.blackhole/hook-events`,
  and the hook-event rotation runs only when the anchor holds. A `cwd` in a repository other than the
  project's clone (a nested repo) is contained to its own root, in the Bash guard too.
- **Anchor not established** (unset, relative, missing, a linked worktree, inside the worker's
  worktree or scratchpad, or not a git clone): the decision is the one made before the anchor
  existed, `mainCloneRoot(cwd)`, and one `main-clone-anchor-unavailable` line goes to stderr per hook
  process. This never adds a deny: the value `CLAUDE_PROJECT_DIR` holds for a natively dispatched
  worker is visible only to the hook process, and failing closed on a wrong guess would block every
  worker write. A repository nested inside a registered campaign linked worktree (back-linked from
  both ends, a repo with a campaign config) is a worker's own and never the campaign clone, so with
  no anchor it is contained to that worktree in the Bash guard and the Write hook, and the config it
  carries grants nothing (variant D). **Residual risk:** with no established anchor a forged clone
  (variants B and C) and a nested repository outside any registered campaign worktree are not
  contained. Variants B and C are tracked in #1615. All close with the OS-level sandbox direction in #1357.

A session whose project dir is a linked worktree is in the second case; start the campaign from the
main clone. A session whose project dir is a main clone but whose `cwd` is in another repository (its
clone or one of its worktrees) is in the first case: the two clones disagree, so that repository's
campaign config grants nothing and no fallback warning is emitted.

Trust is an allow-list of write shapes (`utils/state-dir-write-shape.js`), because the guard
judges a path while the shell picks the file actually written. In the Bash guard, a target under
`.blackhole/` is trusted only when it is written by:

1. a redirect (`>`, `>>`, `>|`, `&>`, a heredoc to a file) or `tee`/`tee -a` naming a file; or
2. `cp`, `mv` or `install` with exactly one source that exists as a regular file (not a symlink
   or directory) to an explicit file destination, using only `-f -i -n -p -v`,
   `install -m <mode>`/`-C` and their exact long names. A `mv` source must itself be a trusted
   path inside `.blackhole/`: `mv` keeps the source's inode, and an earlier clause of the same
   command could swap a worktree file for a link before it runs. To move a worktree file in, `cp`
   it.

Every trusted path (Bash or Write/Edit) must also have no `..` segment (a Bash target must be
plain path text: no quote, expansion, glob or glued operator), resolve inside the state root
once every symlink on the way is followed (an alias from the worktree is judged where it lands),
not be `config.json`, `hook-events/`, `archive/hook-events-*`
(case-insensitive), the root or `archive/` itself, and have a leaf that is absent or a regular
file with one hard link. Anything else under `.blackhole/` (a directory destination such as
`cp x .blackhole/plans/`, `-t`/`-T`, a recursive or archive copy, `rsync`, `ln`, `cp -s/-l`,
`install -d/-D`, `sed -i`, `dd`, `truncate`, a `mv` whose source is outside `.blackhole/` or does not exist yet) gets the same
block as any other main-clone path. A Bash target built from a shell variable is never expanded:
it stays the one warn-and-record `bash-write-target-unresolvable` tier.

## Trusted write roots (scratchpad and cross-repo worktrees)

`trustedWriteRoots(cwd, input)` in `utils/hook-event-log.js` is the one place that names the extra
roots a campaign-scoped caller may write beyond its assigned worktree; the Write/Edit hook and the
Bash write guard both call it, so a root is never trusted by one tool and refused by the other.

- **Scratchpad**: the payload's `scratchpad_dir` (the real PreToolUse payload carries it; it has no
  field for additional working directories), the configured `scratchpad_dir`, and
  `BLACKHOLE_SCRATCHPAD_DIR`. Each must be an existing directory that is not broad (never `/`,
  `$HOME` or a bare temp root, judged on the path and on its realpath). The configured one is read
  from the anchored main clone (see the main-clone anchor above).
- **Cross-repo worktrees**: the union of `permissions.additionalDirectories` from two settings
  sources only: the user file `~/.claude/settings.json`, and `.claude/settings.json` plus
  `.claude/settings.local.json` of the harness project dir `CLAUDE_PROJECT_DIR`. The project dir is
  read only when it is an existing directory a worker cannot write: not inside the assigned root, a
  scratchpad or an admitted root, not strictly inside the cwd's repo, and not a linked worktree
  (its `.git` is a pointer file). For a session in the main clone the project dir is that clone, so
  the owner's project and local settings count; for a worker in a linked worktree only the user file
  does unless the project dir is elsewhere. Nothing is derived from git metadata a worker can write
  (a forged `.git` pointer can name any clone), so the main clone's own settings files are protected
  from writes but never read. An entry is admitted only when it is a registered linked worktree (not
  a main clone, not a symlink) of a repo whose main clone has `.blackhole/config.json`; at most 16
  entries are read per call. Anything else is dropped. Directories added only for one session with
  `--add-dir` are in neither the payload nor a settings file, so they stay uncovered: persist the
  directory in a settings file, or work from the repo's own worktree.

- **Harness auto-memory**: `~/.claude/projects/<project>/memory/<name>.md`, Claude Code's own memory
  directory (harness state, not repository content). Judged by path, not by root
  (`isHarnessMemoryPath`): exactly that depth once symlinks are resolved, a `.md` leaf, a plain file.
  Settings, plugins, rules and `CLAUDE.md` under `~/.claude` stay denied.

A root that spans a main clone, a campaign state dir or a settings file, or lies inside a state dir
or a `.git` dir, is dropped. `mainCloneRoot` refuses a main clone
that resolves inside the worktree pointing at it (a forged `.git` pointer). Settings file names are
matched case-insensitively. Inside an admitted root a Write/Edit target must have no `..` segment, resolve inside it
through every symlink, and have an absent or plain-file leaf (one hard link); the Bash guard allows
only the two write shapes of the state-dir allow-list above (redirect/`tee`, single-file
`cp`/`mv`/`install`), so a directory destination, a recursive copy, a link or `rsync` into one of
these roots keeps the block.

The three settings files are never a worker's to write (`settings-roots-write` for Write/Edit,
`bash-settings-roots-write` for Bash): editing one would widen the roots of the next call.

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
