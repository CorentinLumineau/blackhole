---
type: runbook
summary: "Day-2 operations for the every-20-merged-PR release cadence: owner enablement, optional Haiku notes, force cuts, and failure recovery"
status: current
review_trigger: "on release workflow, release-cadence, or release script change"
created: 2026-11-18
last_updated: 2026-11-24
---

# Release cadence

Automated every-**20**-merged-PR release cut for this repository. The threshold is the single
exported constant `CADENCE_THRESHOLD` in `scripts/lib/release-cadence.ts` — do not copy the
number into the workflow.

Modeled on the monorepo Release Cadence, minus invest catalog / pcfixe. This repo is
GitHub-hosted `ubuntu-latest` only. `scripts/release.ts`, `VERSIONED_MANIFESTS`, and
`.github/workflows/release.yml` stay the publisher — cadence never calls `gh release create`.

Default `bun run release-cadence` is **dry-run only**. `--cut` is what CI runs.

## Owner gates (never an agent)

Workflows, repository variables, and repository secrets are owner-gated. Agents must **not**:

- merge this workflow unprompted
- run `gh variable set` / `gh secret set`
- enable the cadence

Kill switch (owner): `gh variable set RELEASE_CADENCE_ENABLED -b false`

## Enablement

The cut job runs only when the repository variable `RELEASE_CADENCE_ENABLED` is the string
`'true'`:

```yaml
if: vars.RELEASE_CADENCE_ENABLED == 'true'
```

When the variable is unset or not `'true'`, a lightweight `disabled-notice` job emits a
workflow warning so skips are not silent.

**Do not enable** until a baseline `v*` tag exists on `main`. Enabling with hundreds of
unreleased merged PRs would still only cut one batch of 20 notes per run (tagging current
`HEAD`), but the leftover PRs would sit inside that tag without their own notes.

Owner checklist:

1. A `v*` tag already exists on `main`.
2. `bun run release-cadence --json` on an up-to-date `main` shows the expected `count` / `wouldCut`.
3. Set the variable: `gh variable set RELEASE_CADENCE_ENABLED -b true`
4. Monitor the next schedule (`17 */2 * * *`) or dispatch **Release Cadence** manually.
5. Verify: `gh release view vX.Y.Z` — body matches `.github/releases/vX.Y.Z.md`.

## Optional Haiku release notes (Claude subscription)

Deterministic notes from PR titles are always written first and are enough for
`bun run release validate` (100+ characters, TEMPLATE-shaped).

If the owner wants AI-written notes, create a repo secret named `CLAUDE_CODE_OAUTH_TOKEN`
from a Claude Code subscription token (`claude setup-token` on a machine already logged into
that subscription). Agents must not create or print this secret.

The cut step is the **only** workflow step that receives the secret, and it passes the value
only as `CLAUDE_CODE_OAUTH_TOKEN` in that step's environment. The script then:

1. Installs the pinned Claude Code CLI (`@anthropic-ai/claude-code@2.1.296`, same pin as Verify)
   only when the secret is non-empty.
2. Runs `claude -p` with `--model haiku` (the pinned alias `HAIKU_MODEL_ALIAS`), `--max-turns 1`,
   `--permission-mode dontAsk`, `--permission-prompts none`. No `--allowedTools`. Prompt goes
   on stdin. Spawn cwd is an empty temp directory so repo `CLAUDE.md` / hooks / tools do not
   load. `--bare` is **not** used: bare mode skips OAuth, and this path authenticates with the
   subscription token.
3. Treats every PR title/body as untrusted data (delimited blocks, stripped control characters,
   size-capped). Model output is validated (heading, What's new, footer, size cap, no script /
   tool-call / secret markers) and written **only** to `.github/releases/vX.Y.Z.md`.
4. On absent secret, spawn failure, timeout (45s), or validation failure: keep the
   deterministic notes. The cut never blocks on AI.

## Algorithm

On each scheduled run (when enabled):

1. Skip if `github.sha` is no longer `origin/main` (queued run went stale).
2. Skip unless the Verify workflow succeeded on that exact tip SHA.
3. Count merged PRs into `main` since the latest `v*` tag. Cut one batch of 20 even if `N>20`
   (oldest first). Semver from conventional titles: `feat` = minor, else patch,
   `BREAKING CHANGE:` / `type!:` = major.
4. Write `.github/releases/vX.Y.Z.md`, bump `package.json`, `bun run build` so all 7
   `VERSIONED_MANIFESTS` match, commit with `[skip release]`, annotated tag, push `main` + tag.
5. `.github/workflows/release.yml` publishes the GitHub Release from the notes file.

`N<20` is a no-op unless `workflow_dispatch` `force: true`, with one exception: the **early cut**.
When `package.json` is strictly above the latest `v*` tag (an unreleased PR bumped it, as
V-PLUGIN-01 / ADR-030 require for a hook change) and at least one PR is pending, the cut fires
below the threshold and tags `v<package.json version>`. The PR author's version wins; it is
never re-classified or lowered. `[skip release]` on HEAD still blocks a below-threshold cut,
force or early. A second run after the tag lands does not retag.

Catalog availability: there is no registry step. The versioned commit on `main` is what the
Claude `marketplace.json` and Codex `codex-marketplace.json` catalogs resolve, and the tag only
names it (ADR-060).

## Manual / hotfix path

Hotfix-only; the cadence is the primary path (ADR-060). The release commit carries
`[skip release]`. Off-cadence releases use [prj-create-release](../../.claude/skills/prj-create-release/SKILL.md):

```bash
bun run release prepare vX.Y.Z
# edit notes
bun run release validate vX.Y.Z
git commit && git push
bun run release tag vX.Y.Z
bun run release push vX.Y.Z
```

## Emergency `--force`

When `N < 20` but a maintainer must cut immediately:

```bash
gh workflow run release-cadence.yml --ref main -f force=true
```

or locally: `bun run release-cadence --cut --force` (local cuts do not require the repo
variable). Not for routine use.

## Failures

A persistently-failing cut files or comments on a `blackhole/backlog` issue titled
`release-cadence cut is failing on main`. The next successful cut closes it.

A cut that starts after `main` moved past the SHA it was created on skips with a notice
(exit 0). Red Verify on the tip SHA skips without tagging (exit 0). Push failure after a
local tag deletes that local tag before exiting 1.

Follow-up issues must include `Pareto: gain=G effort=E priority=N` (Priority = Gain × (11 − Effort)).

## CLI

| Command | Behavior |
|---------|----------|
| `bun run release-cadence` | Dry-run status |
| `bun run release-cadence --json` | Machine-readable dry-run |
| `bun run release-cadence --prepare` | Write artifacts only (no tag/push) |
| `bun run release-cadence --cut` | Full CI cut path |
| `bun run release-cadence --cut --force` | Cut below the 20-PR threshold |

A `package.json` already above the latest tag cuts early at that version without `--force`.
