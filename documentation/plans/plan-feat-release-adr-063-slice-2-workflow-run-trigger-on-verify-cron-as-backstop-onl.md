---
type: plan
summary: "Run release-cadence on workflow_run of Verify on main, with the cron as backstop and ADR-063 M2 ancestor freshness replacing the exact-SHA check"
status: current
review_trigger: "on release workflow, release-cadence, or release script change"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - Issue #1622

## Objective
Make `release-cadence.yml` start a cut when the Verify workflow completes on `main`
(`workflow_run`), keeping the 2-hourly cron as backstop, `workflow_dispatch force`, the
`CADENCE_THRESHOLD` and all cut logic unchanged (ADR-063 M1, slice 2). GitHub dropped the
12:17-18:17 UTC cron runs on 2026-11-26, so cron alone no longer delivers. The cut's own freshness
check moves from "Verify succeeded on this exact tip SHA" to ADR-063 M2 (newest completed
non-cancelled non-skipped Verify run on `main` is green and an ancestor of the tip), so all three
triggers share one code path and none trusts the event payload.

Pareto: Gain 8, Effort 3, Priority = 8 x (11 - 3) = 64 (>= 30, proceed).

## Touch-Paths
- `.github/workflows/release-cadence.yml`
- `scripts/release-cadence.ts`
- `scripts/release-cadence.test.ts`
- `scripts/lib/release-cadence.ts`
- `scripts/lib/release-cadence.test.ts`
- `documentation/runbooks/release-cadence.md`

No generated mirrors: none of these is a `src/**` build source, so no `bun run build` is needed.

## Documentation Impact
- `documentation/runbooks/release-cadence.md`: Algorithm section (trigger, freshness rule), Failures
  section (red Verify wording), `last_updated`.
- `documentation/decisions/ADR-063-*.md`: None. It already specifies M1/M2; this implements them and
  changes no decision. `documentation/INDEX.md`: None (no new doc, summary unchanged).

## Task Steps
1. **Freshness (scripts/release-cadence.ts, scripts/lib/release-cadence.ts)**
   - Replace `defaultVerifySucceeded(sha, git, env)` with `verifyFreshness(sha, ...)`. List
     `repos/<slug>/actions/workflows/verify.yml/runs?branch=main&event=push&status=completed&per_page=30`
     (`branch=main` excludes tag-push runs), map each row to `{status, conclusion, headSha: head_sha}`
     (GitHub returns newest first), and decide with `evaluateFreshness` (`scripts/lib/release-policy.ts:184`)
     using `isAncestor(root, run.headSha, sha)` (`scripts/lib/stack-merge.ts:63`; `merge-base` is on its
     allowlist). Return `freshness.ok`; log `freshness.reason` when false.
   - Fail closed: a listing error, bad JSON, or an unresolvable SHA (`merge-base` fails) returns false.
   - Keep the `ReleaseCadenceDeps.verifySucceeded` seam name and the call site at
     `scripts/release-cadence.ts:490` so `mockDeps` and every existing cut test stay untouched; only the
     default implementation and its skip message change (`Verify has not succeeded on <sha>` becomes the
     freshness reason).
   - Delete `verifyWorkflowSucceeded` (`scripts/lib/release-cadence.ts:367`), its import, and its
     `describe` block in `scripts/lib/release-cadence.test.ts:303`. Nothing else references it
     (grep-verified at base).
   - Read the data-structure orientation from the call site, not the name: `evaluateFreshness`
     takes runs newest-first and the callback takes the run's `headSha` (`scripts/release-policy.ts:60`
     is the production consumer).
2. **Workflow (.github/workflows/release-cadence.yml)**
   - Add `workflow_run: { workflows: [Verify], types: [completed], branches: [main] }` beside `schedule`
     and `workflow_dispatch`. Update the header comment (triggers; cron is backstop only).
   - `cut.if`: `vars.RELEASE_CADENCE_ENABLED != 'false' && github.ref == 'refs/heads/main' &&
     (github.event_name != 'workflow_run' || (github.event.workflow_run.conclusion == 'success' &&
     github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' &&
     github.event.workflow_run.head_repository.full_name == github.repository))`.
   - `disabled-notice.if`: `vars.RELEASE_CADENCE_ENABLED == 'false' && github.event_name != 'workflow_run'`
     (a Verify run per push would otherwise warn on every merge).
   - Keep `Skip a run that main has outrun` unchanged (a `workflow_run` run's `github.sha` is the
     default-branch tip when it was created). Keep the single `group: release-cadence` concurrency.
   - Security: `github.event.workflow_run.*` appears only in `if:` expressions, never in `run:`/`with:`/`env:`;
     no `ref:` on any checkout (the checkout stays the default-branch tip, never the event's head SHA or
     branch). `permissions` unchanged.
3. **Tests (scripts/release-cadence.test.ts, scripts/lib/release-cadence.test.ts)**: red first, see ACs.
4. **Runbook**: update the Algorithm section: "On each run (Verify completion on `main`, the 2-hourly
   cron backstop, or a forced dispatch)"; step 2 becomes the M2 rule (newest completed non-cancelled
   non-skipped Verify run on `main` is green and an ancestor of the tip); Failures: "A Verify run that is
   not green, or not an ancestor of the tip, skips without tagging (exit 0)". Bump `last_updated`.

## Acceptance Criteria
Each is machine-verifiable by one of the two test files plus `rg`.
- **AC1** (`scripts/release-cadence.test.ts`, new `verifyFreshness` tests with an injected run list and
  ancestor fn): newest completed run green and ancestor returns true; newest completed run red returns
  false even when an older run is green; cancelled/skipped runs are passed over to the next completed
  run; empty list returns false; a green run that is not an ancestor returns false; a listing that
  throws returns false (fail closed).
- **AC2** (workflow structure test): `release-cadence.yml` contains `workflow_run:`, `workflows: [Verify]`,
  `types: [completed]`, `branches: [main]`, the cron line and `workflow_dispatch:` unchanged; `cut` `if:`
  carries `github.ref == 'refs/heads/main'`, `conclusion == 'success'`, `.event == 'push'`,
  `head_branch == 'main'` and `head_repository.full_name == github.repository`; `disabled-notice` `if:`
  excludes `workflow_run`.
- **AC3** (injection and checkout hardening test): every line mentioning `github.event.workflow_run` is a
  YAML comment or starts with `if:` (or is a continuation of the `cut` `if:` block scalar; the test
  asserts on the parsed line set, not on indentation); no `ref:` key anywhere in the file.
- **AC4** (name coupling test): `.github/workflows/verify.yml` has the top-level `name: Verify`, the value
  `workflows: [Verify]` in `release-cadence.yml` must equal.
- **AC5**: the existing `/\b10\b/` and `CADENCE_THRESHOLD` assertions
  (`release-cadence.test.ts:456-460`) still pass (no threshold literal added to the workflow), and
  `rg -n "verifyWorkflowSucceeded|defaultVerifySucceeded" scripts` returns nothing (scope: `scripts/`,
  no exemptions).
- **AC6**: the runbook Algorithm section names the `workflow_run` trigger and the M2 rule, and no longer
  says "On each scheduled run" or "succeeded on that exact tip SHA" (scope:
  `documentation/runbooks/release-cadence.md`, no exemptions).

## Local verification (CI is the verdict)
Run only the two changed test files through `with-test-lock`, after `free -m` MemAvailable >= 2500 MB
(it was 2514 MB at planning time, so re-check; below 3500 MB scoped runs only), plus a typecheck of the
touched files. No full suite, no build. Push once; CI Verify on the pushed head is the evidence.

## Execution Strategy & Stop Conditions
- If `evaluateFreshness` cannot take the mapped GitHub rows without changing its signature, stop and
  report; do not fork a second freshness predicate (V-INT-02).
- If any existing cut test in `scripts/release-cadence.test.ts` needs editing beyond the dep default,
  stop: the `verifySucceeded` seam must stay intact.
- **Post-merge stop condition (not an AC)**: after the owner merges, one real `workflow_run`-triggered
  cut (or a clean `skipped` run with the expected reason) must be observed in the Actions tab before
  ADR-063 slice 2 is declared accepted (ADR-063 M7: "slice 2 is not accepted before one is observed").
  If the workflow_run run errors or never fires, revert the `workflow_run` block; cron and dispatch
  keep working.

## Risks (accepted, stated)
- M2 is ancestor-based, so commits between the verified SHA and the tip can ship unverified by main CI
  (ADR-063 Negative consequences). The prior exact-SHA rule was stricter; this widening is the ADR's
  decision, and `evaluateFreshness`'s "newest completed run must be green" still blocks a red newest run.
- `workflow_run` executes the default branch's copy of the workflow, so this change takes effect only
  after merge. Workflow files are owner-gated at merge; that is the owner's merge decision, not a plan gate.
- Threat screen (STRIDE-lite, route.security_review_required): auth/authz change? no (permissions
  unchanged); user data? no; endpoint? no. The `workflow_run` privileged-context risk is handled by
  AC2/AC3 (fork guard, push-only, main-only, no checkout of event refs, no event data in shell).
