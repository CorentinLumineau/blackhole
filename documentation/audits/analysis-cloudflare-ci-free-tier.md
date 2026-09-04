---
type: research
summary: "Cloudflare @cloudflare/ci free-tier viability for blackhole CI"
status: current
review_trigger: "on release"
created: 2026-08-12
last_updated: 2026-08-12
related:
  - documentation/audits/analysis-ci-pipeline.md
  - .github/workflows/verify.yml
  - documentation/reviews/release-v0.13.1-to-head-audit.md
---

# Research: Cloudflare @cloudflare/ci Free-Tier Viability for blackhole CI

Owner-facing evaluation of Cloudflare's `@cloudflare/ci` stack (Workflows + Sandbox SDK +
Artifacts + R2 cache) as a potential GitHub Actions replacement for blackhole. Produced from
investigator research (issue #593, confidence 82).

## Executive Summary

Cloudflare's `@cloudflare/ci` stack is **not a viable Workers Free-tier CI replacement** for
blackhole or similar personal/small-team repos today. Three hard gates block "free" usage:
**Sandbox SDK requires Workers Paid**, **Artifacts is unavailable on Workers Free** (paid +
private beta today), and **Workflows Free limits compute to 10 ms CPU per step** — far below what
`bun install`, `bun run build`, or `bun test` need (Paid default is 30 s/step, configurable to
5 min).

**Recommendation:** retain GitHub Actions with the current `[self-hosted, mba]` /
`ubuntu-latest` fork split. Do not adopt Cloudflare CI for blackhole.

**Minimum Paid entry cost:** Workers Paid ($5/month account minimum) plus container usage (375
vCPU-minutes/month included), Artifacts operations (10k/month included on Paid), and R2 for
dependency-cache snapshots (R2 free tier is generous: 10 GB storage).

## Free tier limits

| Component | Workers Free | Workers Paid ($5/mo min) | CI viability on Free |
|-----------|--------------|--------------------------|----------------------|
| **Workflows** | 100k requests/day; **10 ms CPU/step**; 3,000 steps/day; 1 GB storage | 10M requests/mo; **30 s CPU/step** (up to 5 min); 500k steps/mo; 1 GB storage included | **Blocked** — 10 ms/step cannot run install/build/test |
| **Sandbox SDK** | **Not available** ("Available on Workers Paid plan") | Container billing: 375 vCPU-min/mo, 25 GiB-h memory, 200 GB-h disk included | **Blocked** — CI SDK runners execute inside Sandbox containers |
| **Artifacts** | **Unavailable** (pricing table: "Unavailable") | 10k ops/mo + $0.15/1k ops; 1 GB storage + $0.50/GB-mo; private beta access | **Blocked** — trigger model is Artifacts-first |
| **R2 (cache snapshots)** | 10 GB storage; 1M Class A; 10M Class B ops/month | Same free allowances; overage billed | **Usable** — but only as adjunct to Paid CI stack |
| **Workers AI (Healer)** | 10k Neurons/day; **kimi-k2.7-code returns 403** (Paid required since 2026-07-28) | 10k Neurons/day included; kimi models 20 req/min | Self-healing **blocked on Free** |

**Verdict:** **not viable on Workers Free** — 10 ms CPU/step, Sandbox unavailable, Artifacts
unavailable.

Workflows billing on Paid began 2026-08-10 (changelog). Free plan users hit hard caps (errors
when storage/step limits exceeded) rather than overage billing.

## vs GitHub Actions

| Dimension | GitHub Actions | Cloudflare CI (@cloudflare/ci) |
|-----------|----------------|--------------------------------|
| **Public repos** | Unlimited minutes on GitHub-hosted runners | Workers Paid minimum + container/Artifacts usage |
| **Private repos** | 2,000 min/month free (GitHub-hosted) | Same Paid minimum; no minute-based free tier for Sandbox |
| **Self-hosted** | Free (own hardware); blackhole uses `[self-hosted, mba]` for trusted events | N/A — Cloudflare-hosted only |
| **Fork PR security** | blackhole routes fork PRs to `ubuntu-latest`, not self-hosted (`verify.yml:24`) | Isolated Sandbox per step — good isolation model, but Paid |
| **Config surface** | YAML workflows | TypeScript Workflows in a deployed Worker |
| **Primary VCS** | GitHub-native | Artifacts-first today; GitHub push triggers "coming soon" (blog) |

**Verdict:** For blackhole (public repo, low-frequency merges, warm self-hosted runner), GitHub
Actions + self-hosted **wins on cost and latency**. The prior CI analysis
(`documentation/audits/analysis-ci-pipeline.md`) measured warm self-hosted protocol work at ~0 s
per step; Cloudflare pays container boot per `runner()` regardless.

## blackhole fit — self-hosted runner alternative

**Current blackhole CI** (code-evidenced):

- `verify.yml`: `bun install` → `bun run build` → `bun run verify` (`VERIFY_SKIP_BUILD=1`) → git
  sync-check → `bun run install:verify`
- Trusted push/tag: `[self-hosted, mba]`; fork PRs: `ubuntu-latest` (security split per
  `verify.yml:22-24`)
- `concurrency` group with tag-safe `cancel-in-progress` already present (`verify.yml:11-13`)
- `release.yml`: tag-only; build + verify + release notes gate on self-hosted

**Security context:** `documentation/reviews/release-v0.13.1-to-head-audit.md` documents V-SEC-05
— public repo + self-hosted runner on fork PRs is CRITICAL; current `verify.yml` mitigates by
gating runner type on `github.event_name`.

**Verdict:** **no replacement case** — keep the current GitHub Actions + self-hosted split. No
Cloudflare deploy target exists in blackhole (no `wrangler.jsonc`); Artifacts does not replace
GitHub as primary VCS; Paid minimum exceeds $0 self-hosted cost; latency adds container
cold-start vs warm MacBook.

## Artifacts vs GitHub

- Artifacts stores git-compatible repos on Cloudflare; triggers CI on `cf.artifacts.repo.pushed`
  (`developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/`).
- Blog and third-party analysis state **no YAML importer**, **Artifacts-first triggers today**,
  GitHub/VCS triggers **coming next**.
- Artifacts pricing: Paid only today; blog promises Workers Free tier "with fair limits" as beta
  progresses — **not available yet** (pricing table: "Unavailable" on Free).
- Typical integration pattern: GitHub remains source of truth → mirror/sync push to Artifacts →
  CI Workflow runs on Artifacts event.

**Verdict:** complementary mirror, not VCS replacement.

## Self-healing CI (Healer / kimi)

- `@cloudflare/ci` exposes neutral runner-failure diagnostics; Healing Agent is
  **application-owned** (`github.com/cloudflare/ci` README; `examples/self-healing/README.md`).
- Default self-healing example uses `Healer.getModel()` → `@cf/moonshotai/kimi-k2.7-code`.
- **Free tier:** 403 on Free plan since 2026-07-28 changelog; requires Workers Paid or prepaid
  AI Gateway credits.
- **Paid tier:** 10,000 Neurons/day included; kimi-k2.7-code at ~86,364 neurons/M input tokens —
  a single heal attempt with large build logs could consume substantial daily allocation.
- Rate limit: 20 req/min (50 with prepaid AI Gateway credits) for frontier models.
- Verified fixes push to `ci-autofix/<branch>`; source run still fails — not equivalent to
  auto-merge.

**Verdict:** blocked on Free; Paid Neuron budget risk. Self-healing pushes commits without
blackhole's review/ledger gates — incompatible with blackhole protocol unless heavily sandboxed.

## Python support

- Sandbox bridge Dockerfile pre-installs **Python 3.13**, Node.js, Bun
  (`developers.cloudflare.com/sandbox/bridge/`).
- Automated testing pipeline tutorial detects `requirements.txt`, runs `pip install` then
  `python -m pytest || python -m unittest discover`
  (`developers.cloudflare.com/sandbox/tutorials/automated-testing-pipeline/`).
- `@cloudflare/ci` examples use `bun` commands but runners execute arbitrary shell — `ruff`,
  `mypy`, `pytest` are **supported via `command` string**, not blocked by SDK.
- `@cloudflare/ci` itself is **not a Node.js package** — pipelines are TypeScript authored in a
  deployed Worker with `nodejs_compat` (`npmjs.com/package/@cloudflare/ci` README).

**Verdict:** feasible via Sandbox (`pytest`, `ruff`, `mypy`).

## Latency — cold start / overhead

- Each `ci.runner()` spins up an **isolated Sandbox** (container). Containers scale to zero;
  charges start on request (`developers.cloudflare.com/containers/pricing/`).
- Dependency `cache` stores install sandbox snapshot in **R2**; subsequent runners reuse
  snapshot when `cache.inputs` (lockfile) unchanged — reduces repeated install latency but not
  first-container boot.
- Workflows provide durable execution with retries; step wall-clock duration is **unlimited** on
  Paid (CPU-bounded), enabling long I/O waits
  (`developers.cloudflare.com/workflows/reference/limits/`).
- **vs self-hosted blackhole:** Warm MacBook shows ~0 s for install/verify/build steps post-setup
  (`analysis-ci-pipeline.md` run 29908494299). Cloudflare will be slower for single-repo
  low-frequency CI unless warm pools are configured (Sandbox bridge documents optional warm pool).

**Verdict:** higher than warm self-hosted; no published p50/p95.

## Monorepo support

- **CI SDK (@cloudflare/ci):** Blog roadmap lists "Monorepos: simplified management for
  multi-Worker deployments using one CI pipeline" as **coming** — not GA at launch (2026-08-04).
- **Workers Builds (separate product):** Monorepo supported via per-Worker root directory, build
  watch paths, Turborepo deploy commands
  (`developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/`).
- **Workaround today:** One Workflow instance per package/repo in Artifacts namespace;
  platform-scale pattern aligns with "millions of repos" framing.

**Verdict:** CI SDK "coming soon"; Workers Builds is deploy-only.

## blackhole repo-specific constraints

| Factor | Evidence | Implication for Cloudflare CI |
|--------|----------|--------------------------------|
| No Cloudflare deploy target | Grep: no `wrangler`/`cloudflare` in tracked `*.json`, `*.yml`, `*.md` | Deploy step irrelevant |
| Bun/TypeScript toolchain | `verify.yml`, `package.json` | Compatible with CI SDK examples (`bun install`, `bun run verify`) |
| ~60 checks, 1217 tests in ~10 s | `.blackhole/config.json` resource_policy note | Small workload — self-hosted warmth matters more than Cloudflare parallelism |
| Public repo + fork PR split | `verify.yml:22-24`, V-SEC-05 audit | Cloudflare isolation good for untrusted code; GitHub ubuntu-latest already provides this |
| Release = annotated tag + notes file | `release.yml`, `verify.yml` release-notes-gate | No mapping to Artifacts-push or `wrangler deploy` trigger |

## Sources

### External — Cloudflare docs & announcements

1. Blog: Run CI/CD for millions of repos — https://blog.cloudflare.com/ci-workflows/ (2026-08-04
   launch; Artifacts-first triggers; R2 cache; roadmap: monorepos, VCS triggers, gradual deploys)
2. Changelog: Build and deploy Artifacts repos on every push —
   https://developers.cloudflare.com/changelog/post/2026-08-04-build-and-deploy-on-push/
3. Artifacts guide: Build and deploy on push —
   https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/
4. Artifacts pricing — https://developers.cloudflare.com/artifacts/platform/pricing/ (Free:
   Unavailable)
5. Artifacts blog (beta pricing, Free tier promise) —
   https://blog.cloudflare.com/artifacts-git-for-agents-beta/
6. Workflows pricing — https://developers.cloudflare.com/workflows/reference/pricing/
7. Workflows limits — https://developers.cloudflare.com/workflows/reference/limits/ (10 ms
   CPU/step Free; 30 s Paid)
8. Workflows billing changelog (steps/storage from 2026-08-10) —
   https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/
9. Workers platform pricing — https://developers.cloudflare.com/workers/platform/pricing/
10. Sandbox overview (Paid plan required) — https://developers.cloudflare.com/sandbox/
11. Sandbox pricing (Containers-backed) —
    https://developers.cloudflare.com/sandbox/platform/pricing/
12. Containers pricing — https://developers.cloudflare.com/containers/pricing/ (Free: N/A for
    vCPU/memory/disk)
13. Sandbox automated testing pipeline tutorial —
    https://developers.cloudflare.com/sandbox/tutorials/automated-testing-pipeline/
14. Sandbox bridge (Python 3.13, warm pool) — https://developers.cloudflare.com/sandbox/bridge/
15. Workers AI pricing — https://developers.cloudflare.com/workers-ai/platform/pricing/
16. Workers AI limits (kimi rate limits) —
    https://developers.cloudflare.com/workers-ai/platform/limits/
17. Changelog: Select models require Workers Paid (kimi-k2.7-code) —
    https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/
18. Workers Builds monorepo —
    https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/
19. Cloudflare pricing summary (R2 free tier) — https://www.cloudflare.com/pricing.md

### External — package & examples

20. `@cloudflare/ci` npm — https://www.npmjs.com/package/@cloudflare/ci (v0.1.0, Workers-only,
    not Node.js executable)
21. `cloudflare/ci` GitHub — https://github.com/cloudflare/ci
22. Self-healing example README —
    https://github.com/cloudflare/ci/blob/main/examples/self-healing/README.md

### External — third-party analysis

23. Developers Digest (2026-08): Artifacts-first, no YAML importer, platform-builder audience —
    https://www.developersdigest.tech/blog/cloudflare-ci-cd-workflows-typescript-2026

### In-repo — blackhole CI state

24. `.github/workflows/verify.yml` — runner split, concurrency, verify pipeline
25. `.github/workflows/release.yml` — tag release gate on self-hosted
26. `documentation/audits/analysis-ci-pipeline.md` — warm self-hosted timing (run 29908494299,
    ~173 s pre-F1; protocol work ~0 s)
27. `documentation/reviews/release-v0.13.1-to-head-audit.md` — V-SEC-05 fork PR / self-hosted
    risk
28. `ARCHITECTURE.md` — CI/CD = GitHub Actions `verify.yml`
29. `.blackhole/config.json` — test footprint (~60 checks, 1217 tests, ~10 s)
30. GitHub issue #593 body — original investigation checklist and code patterns
