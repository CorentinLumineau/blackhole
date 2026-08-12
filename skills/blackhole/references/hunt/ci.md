# Hunt Kind: CI

Scan heuristics, calibration table, and scoring rule for the `ci` hunt kind
(`kaizen.kinds`, [config-template.md](../config-template.md)). This kind walks a consumer
repo's **CI/CD config** for speed, cost, and YAML-verifiable hygiene — missing cache,
missing concurrency cancel, unpinned actions — that no existing kind sees: `bug` is broken
CI, `best-practices` is application SOLID, `quickwins` is source-tree structure. Like every
prior kind, this is a pure additive extension: it reuses every existing kaizen mechanism
verbatim — the `V-HUNT-01` `CONFIRMED` verification gate, `V-PARETO-02` scoring, per-wave
caps, ledger idempotency dedup, and the `hunt_state` watermark
(`territory.bands_scanned`/`bands_done`). It introduces no new scoring formula, no new
ledger field, no new finding schema, and no change to `V-HUNT-01`/`V-HUNT-02` gating logic
(ADR-006 § Hunt kinds).

## Territory bands

`ci` bands by **workflow / pipeline file** — one band per detected file (directory-glob
banding, `coverage.md`-style), carried on the existing generic
`hunt_state.kinds.ci.bands_done` string-array field unmodified — no new field, no prefix
syntax. A wave scans one workflow or pipeline file. Band identifiers are the file paths
themselves (e.g. `.github/workflows/verify.yml`, `.gitlab-ci.yml`).

## Scan heuristics

A `ci` wave first **detects which CI the consumer repo actually uses from on-disk config**,
not from blackhole's own `forge:` field (a GitHub-hosted campaign can still hunt a Gitea or
GitLab consumer tree):

1. GitHub Actions — `.github/workflows/*.{yml,yaml}`
2. Gitea Actions — `.gitea/workflows/*.{yml,yaml}` (Actions-compatible YAML; the same
   GitHub Actions heuristics apply)
3. GitLab CI — `.gitlab-ci.yml` plus files it `include:`s that match `*.gitlab-ci.yml`

Scan every detected system in the wave. If none of the three is present, see § No-CI
degradation — do not invent a fourth CI system, and do not guess a runner. Every candidate
is read/trace-verified before it is reported (`hunter.md` § Verification pass): `CONFIRMED`
means the cited workflow `file:line` was actually re-read against current repo state. Live
CI APIs (`gh run list`, GitLab pipelines) are **optional** for calibrating `gain` from real
durations and are never required — the hunter must work offline from YAML. A plausible
but unread suspicion is `STALE`/not reported.

Broken CI (a job that fails, a syntax error, a missing secret that makes the pipeline
red) stays `bug`. Application SOLID stays `best-practices`. Security-specific footguns
(`pull_request_target`, secrets echoed in logs, fork-PR scheduled on a self-hosted runner)
are **out of scope** for this kind.

Speed/cost + YAML-verifiable hygiene, with GitLab equivalents in parentheses:

1. **Missing dependency/cache** on install or setup steps (`actions/cache`, setup-action
   cache flags, `bun install` / `npm ci` / `pip install` with no cache; GitLab: a job that
   installs dependencies with no `cache:` key).
2. **Missing `concurrency:` / `cancel-in-progress`** on a PR-triggered workflow, so
   superseded runs keep burning minutes (GitLab: job not `interruptible: true`, and no
   `resource_group` serializing the same ref).
3. **Missing path filters** when the workflow's jobs only operate on a subtree — a
   docs-only or frontend-only pipeline that still fires on every push/PR with no
   `on.<event>.paths:` (GitLab: no `rules: changes:`). Do **not** flag a repo-wide verify
   workflow that should run on every PR.
4. **Missing `timeout-minutes`** (or job-level timeout) — a hang can occupy a runner
   indefinitely (GitLab: no `timeout:`).
5. **Duplicate jobs** or `needs:` chains with no data dependency — two jobs that install
   the same toolchain and run the same check, or a linear `needs:` graph that could be
   parallel.
6. **Matrix waste** — unused OS/runtime cells, or `fail-fast: false` with no documented
   reason (GitLab: `parallel: matrix` cells that no job actually exercises).
7. **Unpinned actions** — `uses: org/action@main`, `@master`, or a floating major tag
   with no SHA (GitLab: `image: *:latest`, or `include: { ref: main }` of an unpinned
   foreign project).
8. **Missing `permissions:` block** (defaults to write) or `permissions: write-all`.
   **GHA/Gitea only** — GitLab job-token scope is a project setting, not YAML; skip this
   heuristic on GitLab bands.
9. **Default/long artifact retention** for ephemeral artifacts — GitHub's default 90-day
   `retention-days` on `actions/upload-artifact`, or GitLab `artifacts:` with no
   `expire_in:` (or `expire_in` longer than 7 days) on a non-release job.

Every finding is read-verified before it is reported: the hunter re-reads the cited
`file:line` and only reports `CONFIRMED` findings ([worker-schemas.md](../worker-schemas.md)
§ Hunter). A `CONFIRMED` `ci` finding that clears the `Priority >= 30` gate files through
the same shared [filing.md](filing.md) issue-body template every other kind uses — it does
not invent its own issue-body shape.

## No-CI degradation

If detection finds **none** of GitHub Actions, Gitea Actions, or GitLab CI on disk, the
wave degrades to a **logged no-op** — it is explicitly **not** a failure, and it is **not**
an empty `CONFIRMED` findings list to be read as "CI is fine." The wave note must say
plainly that no CI config was found and no pipeline analysis ran.

This distinction matters for the orchestrator's dry-wave counting: ADR-006's stop condition
("3 consecutive waves filing zero issues → territory exhausted") is about *waves that ran
and genuinely found nothing to file*. A degraded, non-running wave (no CI detected) must
not be conflated with a dry wave — a repo that later adds a workflow should get a fresh
`ci` wave, not one that was already counted toward exhaustion by a CI-less no-op. Mirrors
`coverage.md` § No-runner degradation.

## Finding file/line convention

Re-detecting the *same* gap across waves must yield the *same* `(file, line)` pair so the
ledger's dedup check (`findings-ledger.md` § Write protocol, step 3) collapses re-reports
into one row:

| Heuristic | `file` | `line` | Rationale |
|-----------|--------|--------|-----------|
| Missing cache | The workflow/pipeline file | The install/setup step's `run:` / `uses:` / `script:` line | The gap is the uncached step |
| Missing concurrency / interruptible | The workflow/pipeline file | `0` | Whole-file gap (no `concurrency:` / `interruptible:` block exists) — `parity.md`'s whole-file convention |
| Missing path filters | The workflow/pipeline file | The `on:` (GHA/Gitea) or `workflow:`/`rules:` (GitLab) block's first line | The trigger is where the filter belongs |
| Missing timeout | The workflow/pipeline file | The `jobs.<id>:` / job-name line | Job-scoped hang risk |
| Duplicate jobs / needless `needs:` | The workflow/pipeline file | The redundant job's key line | The extra job is the defect |
| Matrix waste | The workflow/pipeline file | The `matrix:` / `parallel: matrix` key line | The wasted cell lives there |
| Unpinned actions / images | The workflow/pipeline file | The `uses:` / `image:` / `include.ref` line | Pin the cited ref |
| Missing `permissions:` | The workflow file | `0` | Whole-file gap at workflow scope (GHA/Gitea only) |
| Long/default artifact retention | The workflow/pipeline file | The `upload-artifact` / `artifacts:` line | Retention is set next to the upload |

## Severity-term reconciliation note

Like every other hunt kind, the hunter's already-shipped output contract
(`worker-schemas.md` § Hunter, Finding shape) gives `severity` the enum
`LOW | MEDIUM | HIGH | BLOCK`. This kind **reuses that enum as-is** — it does not introduce a
new tier, and it introduces no severity floor the way `bug.md` does. **This kind never
assigns `severity: BLOCK`**: every gap this kind surfaces is wasteful, slow, or
hygiene-risky pipeline config, not a code-breaking defect. `ci` findings go through the
normal `Priority >= 30` gate like every kind other than `bug`'s severity-floor exception
(precedent: `src/references/hunt/parity.md` § Severity-term reconciliation note).

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Severity range | Worked example |
|-----------|---------|------------|---------------|-----------------|-----------------|
| Missing cache | Install/setup step with no cache | 5–8 | 1–3 | MEDIUM–HIGH | `bun install --frozen-lockfile` on every PR with no cache, adding ~40s per run (illustrative, invented) → gain 7, effort 2, severity HIGH → Priority 7 × (11 − 2) = 7 × 9 = 63 (strong candidate) |
| Missing concurrency | PR workflow has no `concurrency:` / `cancel-in-progress` (GitLab: not `interruptible`) | 6–9 | 1–2 | MEDIUM–HIGH | Five pushes to the same PR keep five full verify runs alive on a self-hosted runner (illustrative, invented) → gain 8, effort 1, severity HIGH → Priority 8 × (11 − 1) = 8 × 10 = 80 (top priority) |
| Missing path filters | Subtree-only workflow fires on every push with no `paths:` / `rules: changes:` | 4–7 | 1–3 | LOW–MEDIUM | A `docs.yml` that only builds the docs site still runs on every `src/`-only PR (illustrative, invented) → gain 5, effort 2, severity MEDIUM → Priority 5 × (11 − 2) = 5 × 9 = 45 (moderate) |
| Missing timeout | Job has no `timeout-minutes` / `timeout:` | 4–6 | 1–2 | MEDIUM | A hung integration job occupied the only self-hosted runner overnight (illustrative, invented) → gain 5, effort 1, severity MEDIUM → Priority 5 × (11 − 1) = 5 × 10 = 50 (moderate) |
| Duplicate jobs / needless `needs:` | Two jobs run the same check, or `needs:` with no artifact/data dependency | 4–7 | 2–4 | LOW–MEDIUM | `lint` `needs: build` even though lint never consumes the build artifact, serializing 2 minutes of independent work (illustrative, invented) → gain 5, effort 3, severity MEDIUM → Priority 5 × (11 − 3) = 5 × 8 = 40 (moderate) |
| Matrix waste | Unused OS/runtime cell, or `fail-fast: false` with no reason | 3–6 | 2–4 | LOW–MEDIUM | Matrix includes `windows-latest` but every script is bash-only and the Windows cell is skip/fail noise (illustrative, invented) → gain 4, effort 2, severity LOW → Priority 4 × (11 − 2) = 4 × 9 = 36 (borderline) |
| Unpinned actions | `uses: …@main` / `@master` / floating major; GitLab `image: *:latest` | 6–8 | 1–3 | HIGH | `actions/checkout@main` can change underfoot mid-campaign (illustrative, invented) → gain 7, effort 2, severity HIGH → Priority 7 × (11 − 2) = 7 × 9 = 63 (strong candidate) |
| Missing `permissions:` | Workflow omits `permissions:` or sets `write-all` (GHA/Gitea only) | 5–8 | 1–2 | MEDIUM–HIGH | Default `GITHUB_TOKEN` write on a `pull_request` workflow from forks (illustrative, invented) → gain 7, effort 1, severity HIGH → Priority 7 × (11 − 1) = 7 × 10 = 70 (strong candidate) |
| Long/default artifact retention | Ephemeral artifact keeps default 90-day retention / no `expire_in:` | 3–5 | 1–2 | LOW–MEDIUM | `actions/upload-artifact` of a 200 MB coverage dump with no `retention-days`, billed for 90 days (illustrative, invented) → gain 4, effort 1, severity LOW → Priority 4 × (11 − 1) = 4 × 10 = 40 (moderate) |

`gain` and `effort` are each 1–10, matching the hunter output contract (`worker-schemas.md` §
Hunter, Finding shape). Severity never reaches `BLOCK` for this kind, per the reconciliation
note above — the ranges above are per-heuristic calibration bands, not hard values; a hunter
agent picks the specific score within the listed range based on the concrete gap's actual
scope (a cache miss on a 20-minute install scores toward the top of that gain range; a
missing timeout on a 10-second job scores toward the bottom).

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending
([blackhole-vcodes.md](../blackhole-vcodes.md), `V-PARETO-02`). This is the **only** scoring
formula for the `ci` kind — no alternate or per-kind formula is introduced, and the gating
notes above are input rules layered on top of the one formula, not a second formula or a
second gating mechanism (ADR-006 § Scoring model verdict: "the formula is sound and stays
unchanged as the single SSOT... mercure's mechanisms as input rules under the one formula,
not as parallel formulas"). Findings scoring below 30 are archived in the ledger and never
filed, per the same rule every other kind follows.
<!-- GENERATED by scripts/build.ts from src/references/hunt/ci.md — do not hand-edit -->
