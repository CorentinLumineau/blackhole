---
type: runbook
summary: "Day-2 operations for the every-10-merged-PR release cadence: owner kill switch, optional Haiku notes, force cuts, and failure recovery"
status: current
review_trigger: "on release workflow, release-cadence, or release script change"
created: 2026-11-18
last_updated: 2026-11-24
---

# Release cadence

Automated every-**10**-merged-PR release cut for this repository. The threshold is the single
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
- disable or re-enable the cadence

## Kill switch

The cadence is on by default (owner request, ADR-060 amendment 2026-11-24). The cut job runs
unless the repository variable `RELEASE_CADENCE_ENABLED` is the string `'false'`:

```yaml
if: vars.RELEASE_CADENCE_ENABLED != 'false'
```

Owner stop: `gh variable set RELEASE_CADENCE_ENABLED -b false` (or Settings → Secrets and
variables → Actions → Variables). Owner restart: delete the variable. While it is `'false'`, a
lightweight `disabled-notice` job emits a workflow warning so skips are not silent.

Check after a cut: `gh release view vX.Y.Z` — body matches `.github/releases/vX.Y.Z.md`.

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
3. Count merged PRs into `main` since the latest `v*` tag. Cut one batch of 10 even if `N>10`
   (oldest first). Semver from conventional titles: `feat` = minor, else patch,
   `BREAKING CHANGE:` / `type!:` = major.
4. Write `.github/releases/vX.Y.Z.md`, bump `package.json`, `bun run build` so all 7
   `VERSIONED_MANIFESTS` match, commit with `[skip release]`, annotated tag, push `main` + tag.
5. The `publish` job calls `.github/workflows/release.yml` (`workflow_call`) for the new tag,
   which publishes the GitHub Release from the notes file. A tag pushed with `GITHUB_TOKEN`
   starts no `push: tags` run by itself, so this call is what publishes a cadence release.

`N<10` is a no-op unless `workflow_dispatch` `force: true`, with one exception: the **early cut**.
When `package.json` is strictly above the latest `v*` tag (an unreleased PR bumped it, as
V-PLUGIN-01 / ADR-030 require for a hook change) and at least one PR is pending, the cut fires
below the threshold and tags `v<package.json version>`, or the classified version when the
pending batch classifies higher: never below the classified version. `[skip release]` on HEAD still blocks a below-threshold cut,
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

When `N < 10` but a maintainer must cut immediately:

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
| `bun run release-cadence --cut --force` | Cut below the 10-PR threshold |
| `bun run release-policy [--json] [--force] [--verified-sha <sha>]` | Offline ADR-063 decision from first-parent git history (`--verified-sha` is the newest green main run, asserted green by the caller and not checked by the CLI; without it only `--force` cuts): class (`immediate`, `batch`, `age`, `cooldown`, `force`, `none`), reason, pending count, next version. Not yet wired to the cut |

A `package.json` already above the latest tag cuts early at that version without `--force`.
