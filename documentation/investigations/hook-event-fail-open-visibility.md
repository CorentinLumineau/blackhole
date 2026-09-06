---
type: analysis
status: current
created: 2026-09-06
last_updated: 2026-09-06
review_trigger: "on file change"
issue: 893
confidence: 55
computed_at_revision: 1
---

# Investigation: issue #893 — PreToolUse validator exit-1 fail-open, invisible in-session

## Symptoms

`.blackhole/hook-events/` holds 388 event files (measured this session) across three dates:
235 on 2026-08-12, 6 on 2026-09-01, 147 on 2026-09-06. Of these, 227 carry `tier: "error"`,
`pattern_id: "hook-exec-failure"` — the `scripts/lib/build/claude-native-settings.ts`-generated
shell wrapper's own record that `bun run <validator>.js` exited a code other than 0 or 2, so the
PreToolUse call was allowed with no safety decision at all (`V-HOOK-03`). 226 of the 227 are
timestamped `2026-08-12T20:0x`–`20:5x` UTC (a single hour); the 227th is
`2026-09-06T10:43:10Z` (`F-00079`, the record the issue quotes).

Mechanism (settled, not hypothesis): `buildCommand()` in `scripts/lib/build/claude-native-settings.ts:44-58`
generates `bun run "$CLAUDE_PROJECT_DIR/.claude/hooks/<script>"; code=$?; if 0 or 2, exit; else
record hook-exec-failure and allow`. This is a **documented, intentional design contract** (the
function's own docstring: "anything else means the validator process itself could not run to
completion... That case degrades to allow rather than fail-closed, so an infra hiccup can never
stall the orchestrator's own session"). It is not a bug the codebase is trying to eliminate — the
issue's real ask is *visibility* into when this fires, not removing the fail-open itself.

## Hypotheses

Ranked by evidence strength (not convenience) per the investigate-mode gate:

1. **[Leads] Resource contention during a concurrent-process burst caused `bun run` to fail
   inside its 5s hook timeout.** Evidence for: the 226-event storm is compressed into roughly
   one hour, and `git log` for that same UTC hour (2026-08-12 ~20:39-20:47Z / 22:39-22:47 CEST)
   shows an extremely dense burst of campaign activity — 9 PR merges within 24 seconds
   (`22:43:26`→`22:43:46`) plus a chain of `chore: sync build outputs after rebase onto main`
   commits seconds apart, i.e. many concurrent worktrees each running git/build/test/hook
   processes simultaneously. `templates/hooks/pretooluse/**` (and the generated
   `.claude/settings.json`) still set `timeout: 5` on the PreToolUse hook today, unchanged since
   before the storm — a cold `bun run` start (module resolution, no warm cache) competing with a
   dozen other concurrent processes for CPU/disk is a plausible way to blow a 5s budget, and a
   harness-side timeout kill would surface exactly as a nonzero, non-application exit code with
   no stdout/stderr from the validator itself. Evidence against / gap: the event's `detail` field
   is `"process exit code 1"` only — no stderr, no signal name, no indication whether the exit
   was `bun`'s own (e.g. failed to resolve entry point) or a harness timeout kill re-reported as
   1. **This cannot be distinguished from the record alone.**
2. **A code-level regression, since fixed.** Evidence for: `f0f2d417` (fix #580, "fail closed on
   any uncaught validator exception") merged 2026-08-11 12:59 CEST, ~32 hours before the storm,
   and `f8421a65` (fix #630, "distinguish uncaught-validator crash wording from load failures")
   merged 2026-08-12 18:57 CEST, ~2 hours before the storm — both directly touching this failure
   class the same week. Evidence against: both those fixes wrap the validator's **own** `main()`
   in `try/catch` and route to `failClosed()`, which itself calls `recordEvent()` and would
   produce `pattern_id: "uncaught-validator-error"` (a `deny`, tier `block`/`error` via a
   *different* code path) — not the wrapper's `hook-exec-failure` shape, which is written by the
   **shell wrapper outside the node process** and only fires when the node process exits without
   ever reaching that catch (crash below the JS layer, or killed externally). The two fixes
   landing that week are suggestive timing but do not mechanically produce this exact
   `pattern_id`. **Refuted as the primary cause, kept as context** — this class of bug was being
   actively hardened that week, consistent with elevated crash-proneness generally, but the
   specific storm shape doesn't match what those two fixes touch.
3. **[Demoted — convenience, not evidence] A persistent, still-live code defect.** This was the
   most *convenient* hypothesis to reach for (it would make the issue self-contained: "find the
   bug, fix it"), but it is contradicted by the evidence: the exact same fail-open contract
   (unchanged `timeout: 5`, unchanged 0/2-passthrough wrapper shape) is present in current
   `main` (`c8350578`, `package.json` version `0.21.5`) and produced **one** more occurrence
   today, isolated, not in a burst — a live, reachable code *path* (see Q3 below) but not
   evidence of a single persistent triggering *defect*. Demoted per the investigate-mode gate's
   "leads on accessibility, not evidence" check before it was ever tested.

**Verification requested, not asserted**: reproducing hypothesis 1 needs someone to run a
CPU/IO-saturating concurrent workload (e.g. `parallel_max` at ceiling with several worktrees
each running `bun run` hooks simultaneously) and check whether `bun run` cold-starts miss the 5s
budget under that load — this investigator does not execute that reproduction; it is a delegable
test for whoever implements the fix.

## Root Cause

**Not confirmed — the record's own evidence ceiling is reached.** Two separable facts:

- **Immediate cause of exit 1**: undetermined from available evidence. `detail: "process exit
  code 1"` is the wrapper's entire diagnostic payload (`scripts/lib/build/claude-native-settings.ts:56-58`
  — "The record is deliberately content-free... no stdin/command data" by design, for redaction
  safety, not by oversight). No stderr, no stack, no triggering command is retained anywhere.
  Hypothesis 1 (resource contention under a concurrent-merge burst) is the best-supported
  reconstruction given the timing correlation, at **medium confidence**, not a proven cause.
- **Structural cause of *invisibility***: confirmed, not a hypothesis. `ingestHookEvents`
  (`scripts/lib/hook-event-triage.ts:80`) is real, tested, wired code — but its only call site is
  `orchestrator-runtime.md:82`, inside the background-worker-batch Triage step 1b. The turn-start
  list (`orchestrator-runtime.md` § Session resume & recovery, steps 1-5) ends at the
  Plugin-Drift Signal and never calls it. A hook firing outside an actively-triaged batch (e.g.
  a foreground/interactive Bash call, or a batch whose worker never returns to Triage) writes an
  event that sits until some *future* batch happens to sweep it — confirmed by the ledger itself:
  every existing `V-HOOK-01`/`V-HOOK-02` row (`F-00043`, `F-00058`, `F-00059`, `F-00066`,
  `F-00067`, `F-00069`, `F-00080`, `F-00081`, `F-00082`) cites `file:
  templates/hooks/pretooluse/utils/worktree-removal-guard.js` — a **source-code** location, i.e.
  these were filed by a human/reviewer reading the guard's logic directly, not produced by
  `ingestHookEvents` (which would cite the *event JSON's own path* as `file`, per
  `hook-event-triage.ts:122`). The one exception, `F-00079`, cites
  `.blackhole/hook-events/hook-exec-error-1788691390301148000.json` — the single record this
  issue's own author hand-filed. **`ingestHookEvents` has, to the evidence available, never
  actually executed against this campaign's real backlog.** This is the confirmed root cause of
  "nothing but the event file noticed" — an under-scoped trigger, not a missing or broken
  implementation.

## Resolution

Not this agent's role (investigate-mode gathers evidence only; `router.md`/`planner.md` own the
re-route and fix design). Evidence below is organized against the five questions the spawn
context posed, for the design track to consume directly.

### Q1 — What made the validator exit 1 on 2026-08-12?

Not determinable with certainty from the record. Best-supported reconstruction (medium
confidence): a resource-contention spike coincident with an extremely dense burst of concurrent
campaign activity in the same UTC hour — `git log --since=2026-08-12T00:00 --until=2026-08-13T00:00`
shows 9 PR merges in 24 seconds (`22:43:26`→`22:43:46` CEST = `20:43:26`→`20:43:46` UTC) plus a
chain of post-rebase build-output-sync commits seconds apart, meaning many worktrees were
concurrently running git/build/test/hook subprocesses. The PreToolUse hook's `timeout: 5` (still
current, `scripts/lib/build/claude-native-settings.ts:67`) is a plausible failure point under
that load (cold `bun run` module resolution missing a 5s budget while competing for CPU/disk).
Two fixes to this exact failure class (`#580`, `#630`) landed in the 32 hours before the storm,
which is suggestive of elevated crash-proneness that week but does not mechanically produce the
`hook-exec-failure` pattern (that pattern is written by the **shell wrapper**, not by the
validator's own `try/catch`, so those two application-level fixes are the wrong layer to explain
it). **Confidence: medium on the reconstruction, low on ever confirming it** — the record was
built content-free by design and nothing else in the repo retains stderr for that hour.

### Q2 — Is today's single fail-open the same cause or a different one?

**Different profile, evidence says probably not the same trigger.** The 2026-08-12 storm is 226
events compressed into ~50 minutes (a burst). Today's event (`10:43:10Z`) sits in an otherwise
unremarkable hour: 5 other events total between `10:00`-`11:00` UTC, spread 8-17 minutes apart
(`10:21`, `10:26`×2, `10:43`, `10:53`×4) — no burst, no concurrent-merge signature. Today's whole
day (147 events) is a steady ~10-25/hour drip across 08:00-13:00, not a spike. If hypothesis 1
(resource contention under a merge burst) is right for 08-12, the mechanism does not obviously
recur today — this looks like an independent, lower-frequency occurrence of the same **fail-open
path**, not the same **triggering event**. Confidence: medium (based on absence of a burst
signature, not a confirmed alternate cause for today's instance).

### Q3 — Is the fail-open path even reachable in the current code?

**Yes, unconditionally reachable, and by design — not a stale-cache artifact.** Confirmed
directly: `scripts/lib/build/claude-native-settings.ts` on current `main`
(`c8350578`, repo `package.json` version `0.21.5`) generates the identical wrapper shape
(`bun run ...; code=$?; if 0 or 2 pass; else write hook-exec-failure + allow`), with the same
`timeout: 5`, as at the time of the storm. `git log 465b2be2..HEAD` (the `0.20.0` release tag
commit, matching the installed plugin cache's version) touching `templates/hooks/` and
`claude-native-settings.ts` shows 13 further hook commits — none of them changes this contract;
they add worktree-removal-guard refinements (`#880`, `#853`, `#834`, `#819`, `#818`, `#816`,
`#800`/`#817`, `#799`, `#786`, `#776`, `#734`) and one swallow-catch fix (`#888`) unrelated to
the wrapper's exit-code handling. The function's own docstring states the ERROR-outcome
degrade-to-allow behavior is intentional ("an infra hiccup can never stall the orchestrator's own
session"), confirmed by today's fresh occurrence on current code. **The installed-cache staleness
(`0.20.0`, 15 hook commits behind `0.21.5`) is real (ADR-030 territory) but is not why this fires
— it fires identically on current `main`.** The root-cause leg of #893 is not a stale-cache
question; only the *unrelated* worktree-removal-guard hardening commits are cache-staleness
territory. Confidence: high.

### Q4 — The `CLAUDE_PROJECT_DIR` sink hole (PR #900 / ADR-041)

**Not reachable in this campaign's actual topology, and this is an already-settled decision, not
open evidence.** `documentation/decisions/` does not yet contain ADR-041 (it is staged at
`.blackhole/staged/889/ADR-041-hook-event-anomalous-git-fallback-sink.md`, status `accepted`,
issue #889, dated 2026-09-06 — same day). Its own § Adversarial Evaluation directly addresses
this exact question (critic B's CRITICAL finding) and the owner ruling accepted the risk with
this reasoning: "Under this campaign's actual topology, workers are subagents of the
orchestrator's own session, so `CLAUDE_PROJECT_DIR` is the session project root — the main
clone. The failure critic B describes requires a worker launched as a *separate* `claude` process
with its cwd in a worktree." That premise matches this campaign (`.blackhole/config.json` has no
per-worker-process topology; workers here run as `Agent`/subagent spawns of one orchestrator
session, confirmed by the teammate roster in this very session).

Separately, **the `#900`/ADR-041 fallback code itself is not on `main` yet** — `git branch
--contains 16b99025` returns only `blackhole/issue-891` and `blackhole/issue-895` (open branches),
not `main`; current `main`'s `mainCloneRoot()` (`templates/hooks/pretooluse/utils/hook-event-log.js:78-85`)
is still the pre-ADR-041 bare `try/catch { return null }` shape, with no `CLAUDE_PROJECT_DIR`
fallback at all. So today, the "routine vs anomalous git failure" fallback sink does not exist in
`main` — the sink-hole risk ADR-041 discusses is about a **future** code path, not a live one.

Direct evidence check requested by the spawn context: scanned all 388 events' `worktree` field —
387 are `/Users/morphism/Documents/git/blackhole` (the main clone); exactly one is
`/Users/morphism/Documents/git/worktrees/blackhole/wt-650`, but that record is an unrelated
`tier: "block"`, `pattern_id: "outside-worktree"` `validate-file-changes` denial (`hook-event-log.js`'s
own `worktreeRoot(cwd)` recorded the *target write's* worktree context, not a hook-events sink
location) — it correctly landed in the main clone's `.blackhole/hook-events/`, same as every
other record. **No event in the live backlog shows evidence of a record landing anywhere other
than the main clone.** Confidence: high (both on the topology argument, sourced from an accepted
ADR reasoning about this exact campaign, and on the empirical backlog scan).

### Q5 — What should happen to a 388-event backlog on first ingest?

**This is a real, load-bearing design constraint — confirmed by reading `ingestHookEvents`
directly, not inferred.** `scripts/lib/hook-event-triage.ts:44`:

```
const findingDedupKey = (finding) =>
  `${finding.vcode}\0${finding.file}\0${finding.line}\0${finding.issue_ref ?? ''}`;
```

and the candidate's `file` field (`hook-event-triage.ts:122`) is set to
`` `.blackhole/hook-events/${filename}` `` — **the event JSON file's own generated name**
(`hook-exec-error-<epoch-nanoseconds>.json` for wrapper records, or
`<iso>-<pid>-<random>.json` for `hook-event-log.js` records), which is unique per event by
construction, and `line` is hardcoded `0` for every hook-derived finding. **The dedup key is
therefore unique per event file in practice** — it does not collapse repeat occurrences of the
same `pattern_id`/`hook`/`reason` shape at all. A first run of `ingestHookEvents` over the
current 388-file backlog would append up to 388 new ledger rows in one call (counted by tier:
227 `tier: "error"` → `V-HOOK-03` BLOCK, 111 `tier: "block"` → `V-HOOK-01` BLOCK, 50
`tier: "warn"` → `V-HOOK-02` WARN — i.e. **338 new BLOCK-severity rows** against a ledger that
currently holds 96 findings total, `next_id: 97`). Most would carry `issue_ref: null`
(`resolveIssueRefFromWorktree` only matches a worktree still `in-flight` in `queue.json` today;
the historical events' worktrees are almost all long since cleaned up) — per
`orchestrator-runtime.md:82`'s own stated contract ("An event whose `worktree` matches no
in-flight issue is still appended, with `issue_ref: null` — never dropped"), so these would not
literally block any *specific* PR's merge gate (which appears to scope by issue/PR per
`review-core.md:250`), but they would sit as permanent, unlinked BLOCK debt cluttering the ledger
and the `bun run status` dashboard — a real signal-dilution cost even if not a literal merge
stall. **This is a genuine design constraint the fix must account for**: either (a) a bounded/
age-filtered first ingest (e.g. only events younger than N days, or a one-time archival sweep of
the pre-existing backlog before wiring the always-on trigger), or (b) a redesigned dedup key that
collapses by semantic identity (`pattern_id` + `hook` + tier, not the event file's own generated
name) before this can safely run unattended at turn start. Confidence: high (mechanically
verified by reading the dedup key and candidate-construction code directly).

**Reuse-fit assessment (Doc-Health / Plugin-Drift precedent).** The cadence and existence-gating
shape transfer cleanly: both precedents (`blackhole-state.md` § Doc-Health Signal, §
Plugin-Drift Signal) refresh at turn start and are existence-gated on their script being present.
But the **advisory-only** property does not transfer, and this is the important difference the
spawn context flagged: both precedents write a read-only JSON *signal* file
(`.blackhole/doc-health.json`, `.blackhole/plugin-drift.json`) that never touches `queue.json` or
`findings-ledger.json` and never participates in any gate (`V-DOCHEALTH-03`/plugin-drift
warnings are both explicitly non-blocking, surfaced only on the status dashboard).
`ingestHookEvents` is categorically different: it **mutates the ledger** with BLOCK/WARN-severity
findings under the Single-writer invariant (`blackhole-state.md` § Single-writer invariant), the
same category of action as applying a worker's return JSON, not refreshing a signal file. Simply
copying the doc-health/plugin-drift "refresh a JSON file every turn" shape onto
`ingestHookEvents` without addressing the backlog-sizing and dedup-collapse problem above would
reproduce the visibility fix while introducing a new merge-gate/ledger-noise regression the two
precedents structurally cannot cause. **The analogy is partial, not a drop-in fit** — the design
track should reuse the turn-start cadence and existence-gating idiom, but the ledger-mutation
side needs its own bounding logic that has no precedent in either cited mechanism.

## Sources / evidence trail

- `gh issue view 893` — issue body, AC, and the single `F-00079` record it quotes.
- `.blackhole/hook-events/*.json` (388 files) — direct `jq` tally by `.tier`, `.pattern_id`,
  `.recorded_at`, `.worktree` (this session).
- `.blackhole/findings-ledger.json` — `next_id: 97`, 96 findings, `V-HOOK-*` row `file` fields.
- `git log --since=2026-08-12T00:00 --until=2026-08-13T00:00` — merge-burst timing correlation.
- `f0f2d417` (#580), `f8421a65` (#630) — application-level fail-closed fixes, ruled out as the
  mechanical cause of the `hook-exec-failure` pattern specifically (wrong layer).
- `scripts/lib/build/claude-native-settings.ts` (current `main`) — wrapper contract, `timeout: 5`,
  unchanged since before the storm.
- `git log 465b2be2..HEAD -- templates/hooks/ scripts/lib/build/claude-native-settings.ts` — 13
  commits since the `0.20.0` tag, none touching the exit-code contract.
- `templates/hooks/pretooluse/utils/hook-event-log.js` (current `main`) — `mainCloneRoot`/`recordEvent`,
  confirmed pre-ADR-041 shape (no `CLAUDE_PROJECT_DIR` fallback yet).
- `.blackhole/staged/889/ADR-041-hook-event-anomalous-git-fallback-sink.md` — accepted design
  decision directly addressing Q4's topology question.
- `git branch --contains 16b99025` — confirms `#900`/ADR-041 code is on `blackhole/issue-891` /
  `blackhole/issue-895` only, not `main`.
- `scripts/lib/hook-event-triage.ts` — `ingestHookEvents`, `findingDedupKey`, candidate
  construction (`file`/`line` fields) — read directly, not inferred.
- `orchestrator-runtime.md:82` — sole call site of `ingestHookEvents`; confirmed absent from the
  turn-start list (§ Session resume & recovery, steps 1-5).
