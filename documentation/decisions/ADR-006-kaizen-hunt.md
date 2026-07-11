---
tracking_initiative: blackhole-kaizen-hunt
status: Accepted
scope: orchestration
supersedes: partial (amends ADR-001, does not replace it)
---

# ADR-006: Kaizen Hunt — Proactive Improvement Discovery

## Context

Blackhole's discovery of codebase improvements is strictly **reactive**. The "Continuous
Discovery of Improvements" protocol (`phase-loop.md`) only triages findings that were logged as
side-effects of working an *existing* issue — the implementer's Scout Check, reviewer WARN
deferrals, plan-time V-code scans. No agent or mode proactively scans the codebase to generate
new improvement issues; when the queue is empty, the campaign ends, however much unfixed debt,
missing coverage, or best-practice drift the codebase carries.

[ADR-004](ADR-004-adaptive-phase-routing.md)'s mercure coverage map classified two skills as
"campaign-level" and deliberately out of that ADR's per-issue scope: **`x-improve-hunt`**
("Hunts/files issues INTO blackhole's queue") and **`x-analyze`** ("pre-campaign codebase
auditing"). This ADR is that deferred campaign-level import. A source-fidelity extraction of
both skills (all modes, state schemas, scoring formulas, loop mechanics, stop conditions)
grounded this design; per the fidelity lesson of ADR-004's Amendment, mechanisms are ported,
not just names.

The user-level requirement: the campaign should natively enforce continuous improvement —
small improvements filed and fixed directly, larger refactors/improvements *planned* rather
than hacked in.

## Decision

Add a proactive **hunt capability** as a Phase-5 loop branch plus a manual mode — **not** a new
per-issue queue phase. Issues discovered by hunting are ordinary forge issues that enter the
existing five-phase lifecycle (ADR-001) through the existing plumbing. The new machinery is
confined to the *producer* side:

1. A new **`hunter` agent** (8th agent) — read-only, modeled on `investigator.md` — runs one
   *hunt wave* for one *kind* per spawn and returns verified findings with `gain`/`effort`
   scores.
2. The **orchestrator** applies the existing `V-PARETO-02` gate
   (`Priority = Gain × (11 − Effort) ≥ 30`) to each finding, dedups against the ledger and
   open forge issues, and files qualifying findings as `[Kaizen] <summary>` issues via the
   existing `gh issue create … $(bun scripts/forge-scope.ts create-args)` path with
   `deferred_to_issue` ledger linkage. The next auto-sync ingests them into `queue.json`.
3. **Disposition is delegated to ADR-004 routing, unchanged.** Small improvements carry
   `size:xs/s` labels and route through the quick track; large refactors carry `size:l/xl`
   plus the hunter's evidence and route through `needs_design`/full-plan tracks or
   issue-splitting. The hunt files; the router decides how it gets built. No parallel fix
   loop is imported.
4. A **`kaizen` config block** (modeled on `docs_governance`: absent block or
   `enabled: false` = current behavior preserved exactly) controls kinds, trigger policy,
   wave caps, and the priority floor.
5. The coordinator's **Campaign Launch Configuration Gate** (ADR-005) is extended into a
   **complete launch form** — scope with a targeted-issues preview, merge policy
   (including a new `leave-open` mode), dependency setup, parallelism, and the kaizen
   block — so every campaign run starts from a user-confirmed configuration.

Downstream of issue filing, **zero new code**: queue, router, planner, implementer, reviewer,
merge gate, and ledger cleanup all operate on kaizen issues exactly as on human-authored ones.

### Hunt kinds

Each kind is a reference file `src/references/hunt/<kind>.md` carrying its scan heuristics, a
gain/effort **calibration table** (anchoring the 1–10 scales so `V-PARETO-02` stays the single
scoring SSOT), and kind-specific evidence requirements. The per-kind-file seam is
`x-improve-hunt`'s proven extension point: new kinds are purely additive.

| Kind | Ported from | Scan (mechanism, not label) |
|------|-------------|------------------------------|
| `quickwins` | x-improve-hunt | Dead code, files >300 lines, nesting >4, missing tests for existing logic, over-abstraction; dual-lens structural + quality pass |
| `best-practices` | x-analyze | Concrete SOLID heuristics (SRP: >300 lines / >10 methods / mixed concerns; OCP: switch-on-type; ISP: >7-method interfaces; DIP: concrete imports, no injection), DRY (>5 lines repeated 3+×), KISS (cyclomatic >10), YAGNI (dead/speculative code); per-principle 0–100% scores recorded in the wave note |
| `coverage` | x-analyze | Detect test runner, run coverage, band gaps P1 Critical (auth/payments/validation/error-handling <80%) → P4 Low; testing-pyramid 70/20/10 reference. Degrades to a no-op wave (logged, not failed) when no test runner is detected |
| `refactor` | x-improve-hunt | Structural-debt scan; effort estimate must reflect **blast radius** (files/consumers affected), which pushes large candidates toward the design track naturally |
| `bug` | x-improve-hunt | Read-verified reproducible bugs per territory band; severity recorded alongside gain/effort |

All five kinds ship in v1. Later kinds (`deps`, `docs`, `perf`) slot into the same seam;
`perf` requires the evidence-triage lifecycle and is explicitly deferred.

### Scoring model — `V-PARETO-02` evaluated against mercure, kept as SSOT

Mercure's quickwins formula `(Impact/5) × ((6−Effort)/5) × 100` algebraically reduces to
`Impact × (6−Effort) × 4` — the **same gain-times-inverted-effort family** as blackhole's
`Priority = Gain × (11 − Effort)`, just on coarser 1–5 scales; both normalize to a 0–100
ceiling. Verdict: the formula is sound and stays unchanged as the single SSOT. What mercure
does better is *around* the formula, and those three mechanisms are imported as **input
rules under the one formula**, not as parallel formulas:

1. **Named priority bands** (from mercure's quickwins bands, aligned to the existing ≥30
   floor) — used for ready-set sorting labels and dashboard/wave-note communication:

   | Priority | Band |
   |----------|------|
   | 80–100 | top priority |
   | 60–79 | strong candidate |
   | 40–59 | moderate |
   | 30–39 | borderline (filed, lowest rank) |
   | < 30 | archived, never filed |

2. **Per-kind input semantics** (mercure's per-kind formulas, re-expressed as input
   mappings): for `refactor`, the `effort` input is defined as **risk/blast radius**
   (files + consumers affected), not raw time — mercure's Value/Risk insight that for
   refactors the cost that matters is regression surface; for `coverage`, the `gain` input
   is derived from the criticality band (P1 → 9–10, P2 → 7–8, P3 → 4–6, P4 → 1–3) so
   auth/payments gaps dominate — mercure's band-rank dominance without the band_rank×1000
   hack. Each kind reference's calibration table states its mapping.
3. **Severity floor for bugs** (mercure gates bugs on severity tiers, not Pareto): a
   `CONFIRMED` `bug` finding with severity `CRITICAL` or `HIGH` is **always filed**,
   bypassing the Priority floor — an expensive-to-fix critical bug must never be archived
   as "low value". MEDIUM/LOW bugs go through the normal gate. The floor is an input rule
   at the filing step, not a second formula.

### Hunter output contract (`worker-schemas.md` addition)

```json
{
  "status": "complete",
  "kind": "quickwins",
  "wave": 3,
  "territory": { "bands_scanned": ["src/core/**"], "exhausted": false },
  "findings": [
    {
      "kind": "quickwins",
      "file": "src/core/parser.ts",
      "line": 214,
      "summary": "…",
      "evidence_snippet": "≤8 lines, read-verified",
      "rationale": "failure scenario or improvement rationale",
      "gain": 6,
      "effort": 2,
      "severity": "MEDIUM",
      "verification": "CONFIRMED"
    }
  ]
}
```

Contract rules:

- **Verification pass is unconditional** (x-analyze Phase 2.5, the mechanism ADR-082 exists
  for): before returning, the hunter re-reads every cited `file:line` and classifies
  `CONFIRMED` | `STALE`. Only `CONFIRMED` findings may be filed — filing an unverified finding
  is the new `V-HUNT-01` (BLOCK). STALE findings are recorded in the wave note, never filed.
- **`gain`/`effort` are 1–10**, anchored by the kind's calibration table. The orchestrator —
  not the hunter — computes Priority and makes the file/archive decision, preserving the
  existing separation (reviewer surfaces candidates, orchestrator gates) from
  `review-core.md`.
- One wave per spawn; the hunter never loops internally (context-pressure control lives in
  the orchestrator's wave scheduling, mirroring the one-worker-one-task discipline).

### Orchestrator hunt dispatch (Phase 5 branch + manual mode)

`SKILL.md` gains a `hunt [kind]` mode row (manual invocation, any time). The automatic path
is selected by `kaizen.trigger`:

- **`on-empty`** (default) — amends `phase-loop.md`'s campaign-complete check:

  ```
  Open issues + open PRs both zero?
    → kaizen.enabled AND territory not exhausted AND waves < kaizen.max_waves?
        → run one hunt wave (next kind round-robin from kaizen.kinds), file gated
          findings, auto-sync, continue loop
    → else campaign complete
  ```

- **`every-n-loops`** — additionally, at the top of every `kaizen.loop_interval`-th
  Phase-5 turn (counter in `hunt_state`), run one hunt wave *before* building the next
  batch, so improvements flow in alongside the human backlog. Hunted issues never displace
  human-authored ones in the ready set beyond their Priority rank — the existing
  Pareto-descending sort is the only scheduler. The on-empty branch above still applies at
  queue exhaustion.
- **`manual`** — no automatic waves; only the `hunt [kind]` SKILL mode.

Per wave, the orchestrator:

1. Spawns `hunter` with the kind directive (spawn-context directive pattern, as
   `investigator` sub-modes) and the territory watermark.
2. For each `CONFIRMED` finding: dedup against (a) the ledger idempotency key
   (`vcode/file/line/issue_ref` — hunt findings ledger as `phase: hunt` rows) and (b) open
   forge issues (title/file:line match) so re-hunting never re-files.
3. Applies `V-PARETO-02` (with the bug severity floor: `CRITICAL`/`HIGH` bugs always
   file): `Priority ≥ kaizen.min_priority` → file
   `[Kaizen] <summary>` with the ported issue-body template (Summary / Affected files /
   Verbatim code ≤8 lines / Root cause–rationale / Failure scenario / Fix direction /
   gain·effort·priority footer) + size label derived from effort (`effort ≤ 3` → `size:xs/s`;
   `≥ 7` or multi-file blast radius → `size:l/xl`); set `deferred_to_issue`. Below the floor →
   ledger `archived`, no issue (backlog stays noise-free).
4. Caps filings at `kaizen.max_issues_per_wave`; excess CONFIRMED findings stay `open` in the
   ledger for the next wave's triage (never dropped — the never-drop-findings rule applies).
5. Updates the territory watermark in the ledger's `hunt_state` block and checkpoints.

Stop conditions (ported from `x-improve-hunt`'s autonomous-loop contract): territory exhausted
for all enabled kinds; `max_waves` reached; 3 consecutive waves filing zero issues (dry) →
mark territory exhausted; forge failure → existing error-handling retry rules.

### State: ledger extension, no new store

`x-improve-hunt`'s separate `.claude/improve-hunt/*.json` store is **not** imported.
`findings-ledger.json` is blackhole's findings SSOT; a second store would be blackhole
committing its own `V-INT-03`. Instead:

- Ledger `phase` enum gains `hunt`; hunt findings are ordinary ledger rows using the existing
  statuses (`open` → `deferred` + `deferred_to_issue` when filed; `archived` below the
  Pareto floor).
- A `hunt_state` sibling block (precedent: ADR-004's `routing_decisions[]`) holds the
  per-kind territory watermark: `{ kinds: { <kind>: { bands_done: [], waves: N,
  exhausted: bool, last_wave_at } } }`.
- All mutations follow the existing atomic write protocol (`jq empty` validate, `.tmp` + `mv`,
  `refreshed_at` bump).

### Config block

```json
"kaizen": {
  "enabled": false,
  "kinds": ["quickwins", "best-practices", "coverage", "refactor", "bug"],
  "trigger": "on-empty",
  "loop_interval": 5,
  "min_priority": 30,
  "max_issues_per_wave": 10,
  "max_waves": 6
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `enabled` | `false` | Kill switch; absent block = current behavior preserved exactly (same contract note as `docs_governance`) |
| `kinds` | all five v1 kinds | Round-robin order; each must have a `src/references/hunt/<kind>.md` |
| `trigger` | `"on-empty"` | `on-empty` (hunt at queue exhaustion) \| `every-n-loops` (interleave waves every `loop_interval` Phase-5 turns, plus on-empty) \| `manual` (only the `hunt` SKILL mode) |
| `loop_interval` | `5` | Only read when `trigger: "every-n-loops"`; wave every Nth Phase-5 turn |
| `min_priority` | `30` | Pareto floor; may only be **raised** above 30, never lowered below the `V-PARETO-02` BLOCK threshold |
| `max_issues_per_wave` | `10` | Filing cap per wave |
| `max_waves` | `6` | Per campaign; hard stop independent of territory state |

Ships `enabled: false` — activation is a per-repo opt-in, unlike ADR-004's day-1 activation:
routing has a cautious fallback (today's behavior), but hunting *creates work*, and unbounded
backlog growth on an unattended campaign has no equivalent safe default. The launch form
(below) is where activation is actually decided per run.

### Campaign launch form (coordinator gate, extended)

ADR-005's Campaign Launch Configuration Gate (`coordinator.md` § Bootstrap preflight)
currently confirms only scope and merge mode. It is extended into a complete launch form —
same trigger conditions (first bootstrap, post-campaign-complete restart, explicit
mid-campaign reconfigure), same routine-resume skip carve-out, run in the foreground
coordinator where the `AskQuestion` channel exists (gate-first, fan-out-after — never in
the background orchestrator):

1. **Scope — with targeted-issues preview.** The existing scope question
   (all / label(s) / milestone), then the coordinator runs
   `gh issue list --state open $(bun scripts/forge-scope.ts list-args)` against the
   *chosen* filters and shows the resulting issue count + first titles before accepting —
   the user confirms the actual targeted set, not an abstract filter.
2. **Merge policy (PR gate).** `merge_mode` gains a third value alongside ADR-005's
   `immediate` and `gated-batch`: **`leave-open`** — blackhole never merges; every PR is
   driven to LGTM (review iterations included) and then left open for human review and
   merge. Semantics: an issue with an LGTM'd open PR counts as *delivered* for
   campaign-complete purposes; `merged_by: blackhole` is never set (V-MERGE attribution
   stays clean); ledger `fixed-in-pr` rows stay until the human merge is observed by a
   later sync. The ADR-005 gated-batch+unscoped validation warning is retained unchanged.
3. **Dependency setup.** When `gated-batch` is selected, the coordinator presents the
   planned `merge_after` dependency ordering for the in-scope set (from issue links +
   queue DAG) for confirmation or manual adjustment before the campaign starts.
4. **Parallelism.** Confirm `parallel_max` (default from config).
5. **Kaizen.** Confirm the `kaizen` block: enabled?, which kinds, trigger
   (`on-empty` / `every-n-loops` + interval / `manual`), and — when enabling —
   `max_issues_per_wave` / `max_waves`. Defaults from the table above; disabled remains
   the absent-block default.
6. **Persist + echo.** Write the confirmed fields to `.blackhole/config.json` (atomic
   write protocol), re-run the dashboard, and only then spawn/resume the orchestrator.

Every question uses the coordinator's existing `AskQuestion` convention with the current
config value pre-selected as default, so a routine "keep everything" confirmation is one
answer per section, not a re-entry of the whole config.

### New V-codes

| Code | Rule | Severity |
|------|------|----------|
| V-HUNT-01 | Kaizen issue filed from a finding without a `CONFIRMED` verification pass | BLOCK |
| V-HUNT-02 | Hunt wave filed more than `max_issues_per_wave` issues, or filed below `min_priority` | WARN |

## Components

### `hunter` agent (new — 8th agent)
- **Responsibility**: proactive scanning only. Reads the codebase per its kind reference +
  territory directive; writes nothing but its own wave note; returns the output contract
  above. Never files issues, never mutates queue/ledger (orchestrator's job), never fixes
  anything it finds.
- **Model**: sonnet (scan quality is the product; haiku hunters were the noise source
  mercure's confidence-filtering machinery exists to clean up after). `worker_model_policy`
  matrix gains a `hunter` row.
- **Tool policy**: `disallowedTools: [Write, Edit, Delete]` except its own wave note —
  identical to `investigator`.

### Orchestrator (extended)
Hunt dispatch, Pareto gating + filing + dedup, `hunt_state` watermark, revised
campaign-complete condition. All within the coordinate-only sandbox — the hunter writes the
wave note; the orchestrator only runs `gh`/`jq` and spawns.

### `phase-loop.md` (amended)
The campaign-complete check gains the kaizen branch; "Continuous Discovery of Improvements"
section is generalized to cover both reactive (existing) and hunted (new) findings — one
gating protocol, two producers.

### Coordinator (extended)
Owns the complete launch form (§ Campaign launch form). Touches `coordinator.md` § Bootstrap
preflight only; the three trigger conditions and the routine-resume skip are unchanged.
`merge_mode: leave-open` amends ADR-005's enum in `config-template.md` and adds the
delivered-at-LGTM branch to `phase-loop.md`'s merge protocol and campaign-complete check.

### Reviewer (unchanged)
Kaizen PRs are ordinary PRs. The reviewer's existing V-code audit already re-checks whether
the claimed improvement is real — an independent check on hunter gain-inflation.

### Build & ground truth
`hunter` registered in `scripts/build.ts` agent lists and `ground-truth.md`
(**agent_count: 8**, **skill_mode_count: 8** with `hunt`, vcode_table_rows +2); propagates to
all build targets; `src/` sole edit surface.

## Trade-offs

| Decision | Alternative considered | Choice + why |
|----------|------------------------|--------------|
| Integrate producers into existing plumbing | Port `x-improve-hunt` wholesale (own state store, parallel fix loop, PR babysitter) | **Integrate** — blackhole already owns everything downstream of "issue filed" (queue, workers, review, merge gate); a second fix loop and state store would duplicate ~70% of the campaign engine and create two findings systems |
| Single scoring SSOT (`V-PARETO-02`) with mercure's mechanisms as input rules | Import mercure's four per-kind formulas verbatim (quickwins `(I/5)×((6−E)/5)×100`, coverage band-rank×1000, refactor value/risk, bug severity tiers) | **One formula + bands + per-kind input mappings + bug severity floor** — mercure's quickwins formula is algebraically the same family as `Gain×(11−Effort)` (evaluated in § Scoring model), so importing it verbatim buys nothing but drift; its genuinely better parts (bands, risk-as-effort for refactors, criticality-derived gain for coverage, severity floor for bugs) survive as input semantics under the one gate |
| New read-only `hunter` agent | Orchestrator scans inline; or reuse `investigator` with a third sub-mode | **New agent** — orchestrator is coordinate-only and context-bounded; `investigator` is per-issue evidence-gathering for routing, hunting is campaign-level discovery: same SRP boundary that split investigator from planner in ADR-004 |
| Ledger + `hunt_state` block | Separate `campaign-<kind>.json` per kind (mercure's layout) | **Ledger** — findings SSOT stays single; `routing_decisions[]` is the sibling-block precedent; mercure's per-kind files exist because it *lacks* a campaign ledger |
| Disposition via ADR-004 router | Dedicated kaizen fix track (mercure's `fix` mode with conflict-graph bin-packing) | **Router** — "small improvement vs planned refactor" is exactly what `plan_mode`/`needs_design`/split flags already decide; the hunter only supplies honest size/effort signals |
| `enabled: false` default; trigger configurable (`on-empty` default, `every-n-loops`, `manual`) | Day-1 active; on-empty only; hunt every turn | **Opt-in + configurable trigger** — hunting creates work, so activation is per-repo; on-empty stays the default (human backlog strictly first, "run until empty" becomes "empty and nothing left worth improving"), while `every-n-loops` serves repos that want improvements interleaved with the backlog; the Pareto-descending ready-set sort remains the only scheduler either way |
| Unconditional verification pass before filing | Trust hunter output, let review catch false positives | **Verify pre-filing** — a false positive caught at review has already cost a full plan+implement+review cycle; pre-filing verification is the cheapest point of defense (x-analyze ADR-082 lesson) |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| False-positive or low-value issues pollute the backlog | High | Unconditional verification pass (`V-HUNT-01` BLOCK); `V-PARETO-02` floor; `max_issues_per_wave`; dedup vs ledger + open issues; below-floor findings archived, never filed |
| Campaign never completes (hunt keeps refilling the queue) | High | `max_waves` hard stop; territory watermark; 3-dry-waves exhaustion rule; `enabled: false` default; kill switch honored at every dispatch |
| Hunter inflates `gain` / lowballs `effort` (self-graded scores) | Medium | Calibration tables anchor the scales; orchestrator computes Priority (hunter can't gate itself); reviewer independently audits the eventual PR; scores recorded in ledger rows for human spot-audit |
| Duplicate findings across kinds/waves | Medium | Ledger idempotency key + open-issue dedup at filing time; territory watermark prevents band re-scans within a campaign |
| Large refactors filed as small quickwins (mis-sizing skips the design track) | Medium | Refactor kind's blast-radius effort rule; router re-classifies from issue *content* (labels are tie-break only, per ADR-004) — mis-sizing is corrected at handle, not trusted |
| `leave-open` mode stalls campaign completion on human merge latency | Low | Delivered-at-LGTM semantics: campaign-complete counts LGTM'd open PRs as done; later syncs reconcile actual merges into the ledger |
| Launch form fatigue on routine runs | Low | Current config values pre-selected as defaults — one confirmation per section; routine-resume skip carve-out unchanged |
| Coverage kind breaks on repos without test tooling | Low | Detect-then-degrade: no runner → logged no-op wave, kind marked exhausted |
| Hunt-state block bloats the ledger | Low | Watermark is per-kind aggregate (bands, counts), not per-finding; findings themselves use existing rotation/archival |

## Key Assumptions

| Assumption | Marker | Note |
|------------|--------|------|
| 1–10 gain/effort calibration tables produce sane Priority scores day 1 | ~ Contestable | Zero calibration data; `min_priority` is tunable upward per repo, and ledger rows make miscalibration auditable |
| `loop_interval: 5` is a sane interleave cadence | ~ Contestable | Zero calibration data; tunable per repo, and `on-empty` remains the default trigger |
| Existing router correctly disposes kaizen issues without kaizen-specific flags | ✓ Validated | Router classifies from content; hunter issue bodies carry evidence, scope, and effort — richer than typical human-filed issues |
| Ledger `phase` enum extension is non-breaking for existing consumers | ◐ Blind spot | Consumers must be swept for `phase` switch statements during implementation (schema step lands first) |
| Sonnet-tier hunter waves are affordable at `max_waves: 6` | ◐ Blind spot | One spawn per wave, read-only; first campaigns should watch actual token cost before raising caps |

## Implementation Order

1. **Schema + config**: `kaizen` block in `config-template.md` (+ contract note), ledger
   `phase: hunt` + `hunt_state` block in `findings-ledger.md`, hunter output contract in
   `worker-schemas.md`, `V-HUNT-01/02` in `blackhole-vcodes.md`. Lands first — every later
   step consumes these shapes.
2. **Hunt kind references**: `src/references/hunt/{quickwins,best-practices,coverage}.md`
   with scan heuristics, calibration tables (including the per-kind input mappings from
   § Scoring model), priority bands, and the shared issue-body template
   (`src/references/hunt/filing.md`).
3. **`hunter` agent**: `src/agents/hunter.md` + `build.ts` registration + `ground-truth.md`
   (agent_count 8) + `model-routing.md` row.
4. **Orchestrator dispatch**: SKILL.md `hunt [kind]` mode, Phase-5 on-empty branch +
   revised campaign-complete condition, filing/dedup/watermark protocol in `phase-loop.md`,
   stop conditions.
5. **Launch form**: coordinator gate extended per § Campaign launch form —
   targeted-issues preview, `merge_mode: leave-open` (config-template enum +
   `phase-loop.md` delivered-at-LGTM branch), `merge_after` confirmation step,
   parallelism + kaizen sections.
6. **`refactor` + `bug` kinds**: blast-radius effort rule, severity floor, large-issue
   disposition validation (one hunted `size:l` issue observed routing into the design track
   end-to-end).
7. **Protocol docs + audit**: `blackhole-protocol.md` hunt section, campaign-audit F-code
   for hunt conformance (watermark consistent with ledger, no unverified filings),
   `coordinator-dashboard.md` hunt-wave row.

Each step: `bun run build && bun run verify` green; `src/` sole edit surface; one PR per
issue.
