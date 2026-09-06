---
issue: #885
supersedes_adr: null
rulings_checked_at: 5
ruling_conflicts: []
type: plan
summary: "Pin route.body_hash concatenation convention to sha256(title, newline, body) at one canonical site (queue-dag.md), cite it from worker-schemas.md, findings-ledger.md, router.md, and recovery-protocol.md instead of restating it, add a shared computeBodyHash helper plus CLI recipe, and add a shape check (64-char lowercase hex) to validateRoute so a malformed value like issue 868 real 63-character corrupted hash can never again pass silently"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
---

# Plan - Issue #885 — route.body_hash concatenation convention is unpinned

## Objective

Pin `route.body_hash`'s concatenation convention to exactly one algorithm, cite it from every
placeholder site instead of restating it, add a mechanized shape check so a malformed value can
never again pass `validateRoute` silently, and provide a shared helper + copy-pasteable CLI
recipe so a router agent computes the hash the same way every time.

**Two distinct defects, both fixed here** (per `router-885`'s live investigation, built on
directly, not re-derived):

1. **Convention ambiguity** — `router.md` / `queue-dag.md` say only "sha of issue title+body".
   Sampling 5 routed issues with unchanged bodies found two live conventions: `sha256(title +
   "\n" + body)` (#866, #867, #879) and `sha256(title + "\n\n" + body)` (#871).
2. **Corruption** — `#868`'s stored `route.body_hash` is 63 characters, the only non-64-character
   value in the queue. `validateRoute` (`scripts/lib/worker-json/validators/router.ts:53`) checks
   only `isString`, never length or hex shape, so it passed. Logged as `F-00119`, deferred to
   this issue.

**Honest framing of priority**: nothing programmatic consumes `body_hash` today. `router.ts:53`
type-checks it on write; `scripts/recovery-drift.ts:76-77` takes a pre-computed `routeStale`
**boolean** as input and never hashes anything itself. The actual recompute-and-compare lives
only in prose at `recovery-protocol.md` §8 step 1 — the same underspecified "same hash function
the router uses" phrase that caused the producer-side divergence in the first place. The
divergence is **functionally inert today** and will misfire the moment §8's prose is executed by
hand for the first time. This plan fixes the disease before that first execution, not after an
incident.

**Latent third instance found during planning**: `fixtures/worker-json/router-routed*.json`'s
`body_hash` fixture value, `"abc123def456"` (12 hex characters), is used by 4 `expectValid(...)`
test assertions in `scripts/validate-worker-json.test.ts` — a fixture already shaped like a valid
value's characters but the wrong length, currently invisible to the test suite for exactly the
reason `#868` was invisible to the router: no shape check exists yet. This plan's shape check
would break those 4 currently-green tests unless their fixture value is corrected in the same
diff — see Task 3 and Task 2's red-before-green sequencing below.

## Non-Goals / Orchestrator Follow-up (issue AC #4)

The issue's AC #4 — "existing `queue.json` entries with hashes computed under the old ambiguity
are either migrated or documented as needing one re-route pass" — is **not** a task in this plan.
`queue.json` is orchestrator-owned protocol state (`blackhole-state.md` § Single-writer
invariant); a planner-authored code PR must not hand-patch it, and no existing `route` field
expresses "trigger a mass re-route" (`queue-dag.md` § `route` object has no such flag — this is a
coordinator/orchestrator action, not a router classification). This plan states the follow-up
explicitly instead: **once this PR merges, every issue in `queue.json` carrying a pre-existing
`route.body_hash` needs one re-route pass** (any of the three existing re-route triggers —
`clarify-resolved`, `research-landed`, `investigation-landed` — re-hashes `body_hash` per
`router.md` § Re-route checkpoints; absent a natural trigger, the orchestrator should force one)
before the §8 staleness check is ever exercised against those entries, since none of the 23
routed issues' current stored hashes will match the now-pinned convention. This is a single
sentence of orchestrator guidance, not a code change, and is out of this plan's Touch-Paths.

## Touch-Paths

Documentation (build sources — plus all generated dist trees per `scripts/lib/build/targets.ts`):
- `src/references/queue-dag.md` — canonical algorithm pin + worked example (new subsection)
- `src/references/worker-schemas.md` — placeholder citation
- `src/references/findings-ledger.md` — placeholder citation
- `src/agents/router.md` — placeholder citation
- `src/references/recovery-protocol.md` — §8 step 1 citation, replacing the underspecified phrase

Code (no dist-tree duplication — plain `scripts/`/`fixtures/` files):
- `scripts/lib/body-hash.ts` (new) — `computeBodyHash(title, body)`, the single canonical
  implementation
- `scripts/lib/body-hash.test.ts` (new) — regression test pinning a known title/body → known
  digest
- `scripts/compute-body-hash.ts` (new) — thin CLI wrapper (stdin JSON in, hex digest on stdout),
  the copy-pasteable recipe for router agents (Bash-only tool access) and for `recovery-protocol.md`
  §8's recompute step
- `scripts/lib/worker-json/predicates.ts` — add `isBodyHash` (64-char lowercase hex shape check)
- `scripts/lib/worker-json/validators/router.ts` — line 53: `body_hash` field now validated with
  `isBodyHash` instead of bare `isString`
- `scripts/validate-worker-json.test.ts` — one new `expectInvalid` test case using the real
  63-character `#868` value
- `fixtures/worker-json/router-routed.json` — fix `body_hash` to a real 64-char hex value
- `fixtures/worker-json/router-routed-needs-analysis.json` — same fix
- `fixtures/worker-json/router-routed-ui-true.json` — same fix
- `fixtures/worker-json/router-routed-with-rationale.json` — same fix
- `fixtures/worker-json/router-routed-invalid-body-hash-shape.json` (new) — copy of
  `router-routed.json` with `body_hash` replaced by `#868`'s real stored value
  (`83ba32407f4ed4fe4f3b94ec64e40d6b12ae549c6fb4bad1381f50a0b619bfc`, 63 characters)

No other `router-routed-*.json` fixture needs its `body_hash` corrected: the remaining 7 are all
consumed only via `expectInvalid(...)` for an unrelated field (`task_type`, `confidence` range,
`ui`, `rationale`), so an additional invalidity reason from the new shape check does not change
their expected outcome — touching them would be scope creep with no test-behavior change
(`V-SCOPE-01`).

`route-shape.check.ts` (V-SHAPE-01) is unaffected: it parses `requireField(errors, route,
'body_hash', ...)` for the **field name** only (regex captures the string literal, not the
predicate argument), so swapping `isString` for `isBodyHash` changes zero parsed keys. No edit to
`scripts/checks/route-shape.check.ts` or `scripts/lib/campaign-status/types.ts` is needed or in
scope.

## Documentation Impact

The Touch-Paths above **are** the affected documentation — `src/references/queue-dag.md` becomes
the canonical pin site for the `body_hash` algorithm (its `route` object field table already owns
this field's Notes column, per the routing brief); `worker-schemas.md`, `findings-ledger.md`,
`router.md`, and `recovery-protocol.md` §8 are updated in the same PR to cite it by reference
instead of restating "sha of issue title+body" (`V-DOC-05`). No `documentation/` consumer doc is
affected beyond this plan's own durable copy and INDEX row, staged separately under ADR-021 D3
(see `## Sprint Contract` note).

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test scripts/validate-worker-json.test.ts` and `bun test scripts/lib/` to record the current pass/fail baseline before any file changes. — **AC**: baseline pass/fail counts quoted in the completion evidence; all currently-passing tests (including the 4 `router-routed*` `expectValid` cases) are confirmed green pre-change.
- [ ] **Write Failing Tests (RED)**:
  1. Create `scripts/lib/body-hash.test.ts` asserting `computeBodyHash('Example Issue', 'This is the body.')` equals `31fe5c60c8773642b8cee437c596be10923a2bce4d24aa932d3f58d6f2d73a6e` (see the worked example in `queue-dag.md`'s new subsection). This fails today because `scripts/lib/body-hash.ts` does not exist (module-not-found failure counts as red).
  2. Add `fixtures/worker-json/router-routed-invalid-body-hash-shape.json` (copy of
     `router-routed.json`, `body_hash` replaced with the real `#868` value
     `83ba32407f4ed4fe4f3b94ec64e40d6b12ae549c6fb4bad1381f50a0b619bfc`) and a new test in
     `scripts/validate-worker-json.test.ts`'s `describe('validateWorker router')` block:
     `test('invalid body_hash wrong length (issue #868 real corrupted value)', () => expectInvalid('router', 'router-routed-invalid-body-hash-shape.json'));`. Run it against the **unmodified** `router.ts` first and confirm it fails — `isString('83ba3240...')` is `true` (63 valid hex characters, still a string), so `validateWorker` currently returns `[]` and `expectInvalid`'s `.length).toBeGreaterThan(0)` assertion fails. This is the concrete red: the real corrupted value, not a synthetic one, is accepted today. — **AC**: both new/modified test files exist; `bun test scripts/lib/body-hash.test.ts` fails (module not found); `bun test scripts/validate-worker-json.test.ts -t "issue #868"` fails (assertion: expected length > 0, got 0). Both failure outputs are pasted into the completion evidence before touching any implementation file.
- [ ] **Implement Minimal Logic**:
  1. `scripts/lib/body-hash.ts`: export `computeBodyHash(title: string, body: string): string` returning `createHash('sha256').update(`${title}\n${body}`, 'utf-8').digest('hex')` (Node `node:crypto`). This is the single canonical implementation — no normalization beyond the one `\n` join (no trim, no CRLF conversion), matching the majority convention found live (3 of 5 sampled issues, plus `#868`'s pre-corruption value once its dropped trailing digit is restored).
  2. `scripts/compute-body-hash.ts`: thin CLI wrapper, `import.meta.main`-guarded (same split convention as `scripts/lib/plugin-drift.ts` / `scripts/plugin-drift-signal.ts`), reading `{"title": "...", "body": "..."}` as JSON from stdin (never shell-interpolated argv — issue titles/bodies contain quotes, backticks, `$`, and newlines that would break naive `--title "$TITLE"` argv passing) and printing `computeBodyHash(title, body)` to stdout.
  3. `scripts/lib/worker-json/predicates.ts`: add `export function isBodyHash(value: unknown): value is string { return isString(value) && /^[0-9a-f]{64}$/.test(value); }` (64-character lowercase hex sha256 digest shape — matches the pattern used by `isConfidenceScore`/`isGainEffortScore`: a named, domain-specific predicate rather than a generic reusable one, since `body_hash` is this predicate's only consumer today — `V-YAGNI-03`).
  4. `scripts/lib/worker-json/validators/router.ts` line 53: change `requireField(errors, route, 'body_hash', isString, 'string');` to `requireField(errors, route, 'body_hash', isBodyHash, '64-character lowercase hex sha256 digest');`, and add `isBodyHash` to the existing `from '../predicates.ts'` import.
  5. Fix `body_hash` in the 4 fixtures used by `expectValid`: `router-routed.json`, `router-routed-needs-analysis.json`, `router-routed-ui-true.json`, `router-routed-with-rationale.json` — replace `"abc123def456"` with `"31fe5c60c8773642b8cee437c596be10923a2bce4d24aa932d3f58d6f2d73a6e"` (the worked-example digest; fixture value only needs to satisfy the shape predicate, not correspond to the fixture's own fictional title/body).
  — **AC**: both new tests from the previous task now pass; `bun test scripts/validate-worker-json.test.ts` (full file) passes with zero regressions against the Task 1 baseline; `git diff --name-only` against `plan_base_commit` (`aa71138a`) shows no file outside the declared Touch-Paths.
- [ ] **Pin and cite the convention in documentation**:
  1. `src/references/queue-dag.md`: in the `body_hash` Notes-column cell (currently "sha of issue title+body at classification time; staleness marker"), state the concrete algorithm and point to a new subsection immediately after the `route` object field table (before "**Consumer status**"): `#### `body_hash` algorithm (canonical, issue #885)`, containing (a) the normative definition — `sha256(title + "\n" + body)`, UTF-8 bytes, no further normalization; (b) a pointer to `scripts/lib/body-hash.ts`'s `computeBodyHash` as the canonical implementation and `scripts/compute-body-hash.ts` as its CLI wrapper; (c) the copy-pasteable recipe `echo '{"title": "Example Issue", "body": "This is the body."}' | bun run scripts/compute-body-hash.ts`; (d) the worked example table (`title`: `Example Issue`, `body`: `This is the body.`, concatenation `Example Issue\nThis is the body.` — 31 UTF-8 bytes, one `\n` — `body_hash`: `31fe5c60c8773642b8cee437c596be10923a2bce4d24aa932d3f58d6f2d73a6e`); (e) a one-line pointer to `scripts/lib/body-hash.test.ts` as the mechanized regression guard. Leave the `route` object's fenced JSON example's `body_hash` value as a placeholder (unchanged key set — `V-SHAPE-01` leg 2 checks keys, not values).
  2. `src/references/worker-schemas.md:377`, `src/references/findings-ledger.md:226`, `src/agents/router.md:235`: change the placeholder value `"<sha of issue title+body at classification time>"` (or `"<sha>"`) to `"<sha256 hex digest — see queue-dag.md § body_hash algorithm for the exact convention>"`, citing the canonical site instead of restating it (`V-DOC-05`).
  3. `src/references/recovery-protocol.md` §8 step 1: replace "Recompute the current issue body hash (title + body, same hash function the router uses at classification time — router ships in issue #95)." with a step that names the concrete mechanism: recompute via `scripts/compute-body-hash.ts` (or `computeBodyHash` directly, `scripts/lib/body-hash.ts`), citing `queue-dag.md` § `body_hash` algorithm for the convention, replacing the now-resolved "router ships in issue #95" forward-reference (router has since shipped).
  — **AC**: `grep -c "sha of issue title" src/references/worker-schemas.md src/references/findings-ledger.md src/agents/router.md` returns `0,0,0` after the edit (placeholder text fully replaced, not duplicated); `grep -c "body_hash algorithm" src/references/queue-dag.md` returns `>= 1`; the new `#### \`body_hash\` algorithm` subsection exists and its worked example matches `scripts/lib/body-hash.test.ts`'s pinned digest byte-for-byte.
- [ ] **Verify Integrity**: Run `bun test scripts/validate-worker-json.test.ts scripts/lib/body-hash.test.ts` (targeted) and the full `bun run verify` (build + all checks, including `route-shape.check.ts` for `V-SHAPE-01` non-regression). — **AC**: full suite green, `bun run verify` clean, both quoted in the completion evidence; explicit confirmation that `route-shape.check.ts`'s field-set parity check still passes (predicate swap does not change parsed key names, per the Touch-Paths note above).

## Sprint Contract

Every task above carries its own machine-verifiable AC; none relies on a blanket "tests and
linters pass" fallback. Definition of done: the red tests from Task 2 (module-not-found on
`body-hash.test.ts`; accepted-63-char-value on the `#868` fixture test) turn green after Task 3;
the 4 previously-green `expectValid` fixture tests stay green after their `body_hash` fix; the
documentation grep ACs in Task 4 pass; `bun run verify` is clean; and `git diff --name-only`
against `aa71138a` shows only the declared Touch-Paths changed.

**Durable plan staging (ADR-021 D3)**: `docs_governance.enabled` and `docs_governance.write_governance`
both resolve `true` on this campaign, so this plan's durable copy and root `documentation/INDEX.md`
row are staged (not committed — no PR branch exists yet at planning time) at
`.blackhole/staged/885/plan-route-body-hash-concatenation-convention-is-unpinned-routers-compute-it-differen.md`
and `.blackhole/staged/885/plan-index-row.md`, with matching entries appended to
`.blackhole/staged/885/manifest.json`. The implementer's carry-step commits both into the issue's
own PR (`implementer.md` § Carry Staged Artifacts) — this plan performs no `documentation/` write
itself.

## Quality Gate Results (advisory — Quick track; `plan-quality-gate.ts` is a Standard-track-only
gate per Step 8, run here at the orchestrator's explicit request for evidence)

```json
{
  "ac_mapping": true,
  "critical_files_exist": true,
  "mitigation_concrete": true
}
```

`ac_mapping` is true because every `## Task Breakdown` bullet above carries its own `— **AC**:`
clause (Sprint Contract restates, does not substitute for, these per-task criteria).
`critical_files_exist`/`mitigation_concrete` report true trivially — this Quick-track plan has no
`## Critical Files` or `## Execution Strategy & Stop Conditions` section for the CLI to inspect
(`extractSection` returns `''`, and `findMissingCriticalFiles('', ...)` /
`findVagueMitigations('')` both vacuously return no findings on an empty section), consistent
with `planner.md` Step 8's "Section-presence gating, not track-gating" framing for those two
checks specifically.

## Pareto Gating

Gain: 6 (closes a currently-inert but latent staleness-detection footgun before its first live
execution, catches an already-occurred corruption pattern mechanically going forward, and fixes 4
already-blind-spot test fixtures). Effort: 3 (one new small helper + CLI wrapper, one predicate,
one validator line, four fixture value edits, one new fixture, five prose citation edits — all
mechanical, no new architecture). Priority = 6 × (11 − 3) = 48 ≥ 30 — passes the filing gate
(`V-PARETO-03`).

## V-code Compliance

- `V-INT-02`: `computeBodyHash` is the single implementation; the router prompt and
  `recovery-protocol.md` §8 both invoke it (via CLI) rather than each re-deriving the algorithm in
  prose.
- `V-DOC-05`: the algorithm is stated once, at `queue-dag.md`; the other three placeholder sites
  and `recovery-protocol.md` cite it by reference.
- `V-KISS-01` / `V-YAGNI-01`: no new abstraction beyond one pure function + one CLI wrapper + one
  predicate; `isBodyHash` is deliberately domain-specific (not a generic `isSha256Hex` utility)
  since it has exactly one consumer.
- `V-SCOPE-02`: Touch-Paths above are exhaustive; the 7 `router-routed-*.json` fixtures that don't
  need a `body_hash` fix are explicitly named as out of scope with the reason.
