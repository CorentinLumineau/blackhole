---
type: runbook
summary: "Automated release cadence cuts one GitHub release every 20 merged PRs when RELEASE_CADENCE_ENABLED is true"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
---

# Release cadence

Cuts one `vX.Y.Z` release every `CADENCE_THRESHOLD` (20) PRs merged into `main`.

The workflow is [`.github/workflows/release-cadence.yml`](../../.github/workflows/release-cadence.yml). The cut script is [`scripts/release-cadence.ts`](../../scripts/release-cadence.ts). Publishing the GitHub Release stays in [`.github/workflows/release.yml`](../../.github/workflows/release.yml) — cadence only prepares notes, bumps version, rebuilds the 7 versioned manifests, commits with `[skip release]`, and pushes an annotated tag.

## Owner enablement

Cadence is off until the owner sets the repository variable:

```bash
gh variable set RELEASE_CADENCE_ENABLED -b true
```

Do not set this from a PR. The cut job runs only when `vars.RELEASE_CADENCE_ENABLED == 'true'`. When the variable is unset or any other value, the workflow posts a warning and does not tag.

Disable the same way:

```bash
gh variable set RELEASE_CADENCE_ENABLED -b false
```

## What a cut does

1. Skip if this run's SHA is no longer `origin/main`.
2. Skip unless the **Verify** workflow succeeded on that exact SHA.
3. Count PRs merged into `main` since the latest `vX.Y.Z` tag.
4. No-op when `N < 20`, unless `workflow_dispatch` with `force=true`.
5. Take one batch of 20 (oldest first) even when `N > 20`.
6. Semver from conventional titles: `feat` → minor, `BREAKING CHANGE` / `type!:` → major, else patch.
7. Write `.github/releases/vX.Y.Z.md` from PR titles, bump `package.json`, run `bun run build`.
8. Commit `chore(release): prepare vX.Y.Z [skip release]`, annotated tag, push `main` then the tag.
9. `release.yml` on the tag publishes the GitHub Release; the body is the notes file.

## Safety

- Hosted `ubuntu-latest` only.
- Concurrency group `release-cadence` (`cancel-in-progress: false`).
- A second run does not retag an existing tag or notes file.
- A failing cut opens or comments on a tracking issue titled `release-cadence cut is failing on main`; a later successful cut closes it.
- Cadence never closes a GitHub milestone. See [release-milestone-governance](../../.github/rules/release-milestone-governance.mdc).

## Manual dry-run

```bash
bun run release-cadence
bun run release-cadence --json
```
