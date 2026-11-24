---
type: adr
summary: "The every-20-merged-PR cadence is the primary release path; manual bun run release is hotfix-only with [skip release] on its commit; a package.json already above the latest tag cuts early below the threshold at that version; the marketplace catalogs resolve the versioned commit on main, with no registry step"
status: accepted
review_trigger: "on a change to the cadence gate, CADENCE_THRESHOLD, the early-cut rule, the marketplace catalogs, or the release skill"
created: 2026-11-24
last_updated: 2026-11-24
related:
  - scripts/lib/release-cadence.ts
  - scripts/release-cadence.ts
  - documentation/runbooks/release-cadence.md
  - documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md
---

# ADR-060: Cadence-primary release policy and early cut

## Status

Accepted — 2026-11-24, owner request (issue 1324), after the cadence automation landed.

## Context

The cadence (`release-cadence.yml`, every 20 merged PRs) exists, but the skill, checklist and
governance rule still read as if the manual `bun run release` flow were the default. A hooks fix
also stays inert until a tag ships its version: the installed plugin cache is keyed by version
(ADR-030), so a PR that bumps `package.json` waits for the next 20 merges.

## Decision

1. **Cadence is primary.** Releases are cut by the cadence. Manual `bun run release` is for
   hotfixes only, and its release commit carries `[skip release]` so the cadence does not race a direct push of it (a release merged through a PR is covered by the notes check below).
2. **Early cut.** The gate cuts below the threshold when `package.json` is strictly above the
   latest `v*` tag, at least one PR is pending and HEAD lacks `[skip release]`. The tag is
   `v<package.json version>`: the PR author's version wins, with no re-classification and never
   lowered. The no-retag and Verify guards are unchanged.
3. **Milestones.** The cadence never closes a milestone. Closure stays in the maintainer pass of
   the governance rule.
4. **Catalog availability.** There is no registry step. The versioned commit on `main` is what the
   Claude and Codex catalogs resolve; the tag only names it.
5. **Owner gates unchanged.** `RELEASE_CADENCE_ENABLED` and the secrets stay owner-only.

## Consequences

- A hooks fix with its version bump ships on the next 2-hourly run after Verify is green.
- Two merged PRs that both bump the version cut once, at the version on `main`.
- A bump left on `main` without a following merged PR waits for the next PR or the threshold.
- A release whose notes are already committed for the bumped version (a manual release merged through a PR, which carries no `[skip release]` subject) is not early cut: the cadence leaves it to its manual path rather than failing on the existing notes file. `[skip release]` guards only a direct push of the release commit.
