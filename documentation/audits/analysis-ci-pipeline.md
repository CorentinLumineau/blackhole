---
type: analysis
skill: x-analyze
created: 2026-07-22
target: "CI pipelines (.github/workflows/verify.yml, release.yml)"
status: draft
---

# CI Pipeline Optimization Analysis

**Method**: read both workflow definitions + the `setup-bun` composite action, and pulled the
per-step timing of the latest completed `Verify` run on `main` (run `29908494299`, 173s).

## Headline finding

**~95% of every CI run is Bun setup/cache overhead that is pure waste on the self-hosted
runner.** The actual protocol work (install, verify, build, sync-check, install:verify) completes
in ~0s because the self-hosted MacBook (`[self-hosted, mba]`) is already warm.

### Evidence — per-step breakdown of run 29908494299 (173s total)

| Step | Time | % |
|------|------|---|
| Set up job + Checkout | 4s | 2% |
| **Setup Bun** | **109s** | **63%** |
| Install dependencies | 0s | — |
| Run verify | 0s | — |
| Run build | 0s | — |
| Verify build is in sync | 0s | — |
| Run install:verify | 0s | — |
| **Post Setup Bun** (cache upload) | **55s** | **32%** |
| Post Checkout + Complete | 1s | — |

The `Setup Bun` composite (`.github/actions/setup-bun/action.yml`) does two things, both
counterproductive on a persistent self-hosted runner:

1. `oven-sh/setup-bun@v2` re-downloads/installs Bun 1.3.14 every run (**109s**) — but the
   self-hosted MacBook already has Bun installed and on PATH.
2. `actions/cache@v4` saves `~/.bun/install/cache` to GitHub's cache service on every run
   (**55s** post-step) — but on a self-hosted runner that directory already persists on local
   disk between runs. Uploading it to GitHub's remote cache is round-trip cost for zero benefit.

## Findings (Pareto-ranked)

### HIGH — F1: Bun setup + `actions/cache` run on the self-hosted runner where both are no-ops

`setup-bun` and its cache step make sense on the ephemeral `ubuntu-latest` runner (used for
`pull_request` from forks) but are pure overhead on `[self-hosted, mba]` (used for trusted
push/tag). They account for **164s of the 173s run**.

*Fix*: gate the composite on runner type. On self-hosted, skip `oven-sh/setup-bun` (assume the
preinstalled Bun, optionally assert `bun --version` matches the pin) and skip `actions/cache`
(local disk already persists). Keep both on `ubuntu-latest`.

*Impact*: **~173s → ~10s per push/tag run (~94% reduction).** Every merge this session paid this
tax; the release just now paid it twice (see F3).

### MEDIUM — F2: No `concurrency` group — superseded runs are not cancelled

`verify.yml` has no `concurrency:` block. Rapid pushes to the same ref (e.g. this session's
force-push on `blackhole/issue-317`, and back-to-back merges to `main`) each launch a full run;
older in-flight runs are not cancelled and serialize on the single runner.

*Fix*: add
```yaml
concurrency:
  group: verify-${{ github.ref }}
  cancel-in-progress: true
```
(Do NOT set `cancel-in-progress` on the release/tag path — a release build should never be
cancelled mid-publish; scope the group to non-tag refs or use a separate group for tags.)

*Impact*: eliminates redundant queued runs on active branches; compounds with F1.

### MEDIUM — F3: Tag pushes run Verify AND Release serially on the single runner, each paying full setup

The `v0.16.0` tag triggered **both** the `Verify` workflow (`verify` job runs on `tags: ['v*']`)
and the `Release` workflow on the same single `[self-hosted, mba]` runner — they serialize
(observed: Release `in_progress` while Verify `queued`). `release.yml` already runs
`build` + `verify` (with `VERIFY_SKIP_BUILD=1`), so the tag path does the full verify+build
**twice**, back-to-back, each paying the ~164s setup tax.

*Fix*: after F1 makes setup cheap this matters less, but cleanest is to not run the `verify` job
on tag refs (let `release.yml` be the release gate; keep only `release-notes-gate` on tags), or
add `needs`/reuse so the release consumes the verify result instead of repeating it.

*Impact*: roughly halves end-to-end release time; removes one redundant full build+verify.

### LOW — F4: `verify.yml` builds twice (`bun run verify` builds internally, then `bun run build`)

`release.yml` sets `VERIFY_SKIP_BUILD: "1"` on its verify step precisely because `bun run verify`
runs a build internally — but `verify.yml` does **not**, so it builds once inside `verify` and
again in the explicit `Run build` step. On the warm self-hosted runner both currently show ~0s,
so impact is negligible today; it would matter on the `ubuntu-latest` PR path where builds aren't
warm.

*Fix*: reorder to `build` → `verify` (with `VERIFY_SKIP_BUILD=1`) → sync-check, so the build runs
exactly once and the sync-check still has a fresh build to diff.

## Recommendation summary

1. **F1 (HIGH)** — skip `setup-bun` + `actions/cache` on `[self-hosted, mba]`; keep them on
   `ubuntu-latest`. Single biggest win (~94% per-run cut). Effort: ~15 min (conditional in the
   composite action or a runner-type guard).
2. **F2 (MEDIUM)** — add a `concurrency` group with `cancel-in-progress` (non-tag refs). Effort:
   ~5 min.
3. **F3 (MEDIUM)** — stop double-running verify on tags (Verify job excludes tags; release.yml is
   the gate). Effort: ~10 min.
4. **F4 (LOW)** — single build in `verify.yml` via `VERIFY_SKIP_BUILD=1` + reorder. Effort: ~5 min.

F1 alone takes the typical push CI from ~3 min to well under 30s.
