---
type: runbook
summary: "Cloud Agents on this repo install Mercure and Blackhole from GitHub, not the marketplace cache"
status: current
review_trigger: "on file change"
created: 2026-09-12
last_updated: 2026-09-12
---

# Cloud Agent plugins (GitHub-sourced)

Cursor Cloud Agents working **on this repository** must load Mercure (`/x-auto`, `/x-plan`, …)
and Blackhole (`/blackhole`, coordinator/orchestrator) from GitHub, not from a stale
version-keyed marketplace cache.

## Why

- Environment builds start with an empty `~/.cursor/plugins/cache`.
- Mercure's marketplace `gitPath` is `mercure-plugin/`, which is missing in the flattened cache,
  so declared skills stay empty even when the cache *is* present.
- `bun run build` wipes `.cursor/` (`cleanDir`), so Cloud config cannot live only as a
  hand-edit there.

## What `install` / `start` do

`scripts/cloud-agent-plugins.sh` (invoked from `.cursor/environment.json` `install` and
`start`):

1. Clones or updates `https://github.com/CorentinLumineau/mercure` into
   `~/.cursor/src/mercure`.
2. Copies `mercure-plugin/cursor-dist` (real files, never cache symlinks) to
   `~/.cursor/plugins/local/mercure` and overlays skills into `.cursor/skills/` (`x-auto`
   included). Skips overlaying a skill named `blackhole`.
3. Materializes this checkout's `.cursor/{skills,agents,rules}` into
   `~/.cursor/plugins/local/blackhole`. If that tree is missing, clones
   `https://github.com/CorentinLumineau/blackhole` as fallback.
4. Falls back to the marketplace cache **only** when the Mercure GitHub clone fails, and logs
   the GitHub App unblocker.

## Source files vs generated copies

| Path | Role |
|------|------|
| `templates/cursor-cloud/environment.json` | SSOT for Cloud `install`/`start`/`repositoryDependencies` |
| `templates/cursor-cloud/settings.json` | SSOT for enabling `mercure/mercure` and `blackhole/blackhole` |
| `.cursor/environment.json`, `.cursor/settings.json` | Copied by Target B (`copyCursorCloudConfig`) after `cleanDir(.cursor)` |

Do not hand-edit the `.cursor/` copies — they are overwritten on the next `bun run build`.

## Token scope

`.cursor/environment.json` lists:

- `github.com/CorentinLumineau/blackhole`
- `github.com/CorentinLumineau/mercure`

The generated Cloud GitHub token includes those repos only when this file is on the revision
used to start the agent (repo-managed environment) **and** the Cursor GitHub App is granted
access.

## Unblocker if Mercure clone fails

Private Mercure is required. If
`git ls-remote https://github.com/CorentinLumineau/mercure.git HEAD` fails on a Cloud VM:

1. Open https://github.com/apps/cursor → **Configure** → **CorentinLumineau**
   (or https://github.com/settings/installations).
2. Grant repository access to **CorentinLumineau/mercure** (private, required) and
   **CorentinLumineau/blackhole**.
3. New agents started from this repo's `.cursor/environment.json` then get a token scoped
   via `repositoryDependencies`.
