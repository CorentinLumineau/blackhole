---
type: plan
summary: "Refuse a state-file write whose entity container type (array vs object) differs from the live file, and non-numeric issue keys"
status: current
review_trigger: "on file change"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - Issue #1639

## Objective
`validateStateWrite` must refuse a `.tmp` whose `entityKey` container type (array vs object) differs from the live file's, for both `issues` and `findings`, naming both types in the refusal reason. For `issues` it must also refuse object keys that are not issue numbers. Root cause: `countEntities` collapses array and object to a bare count, so `jq '.issues |= map(...)'` (object -> same-size array) validates (seen live 2026-11-26).

Pareto: Gain 6 x (11 - Effort 2) = 54 >= 30, proceed.

## Touch-Paths
- `scripts/lib/state-write-guard.ts`
- `scripts/lib/state-write-guard.test.ts`
- `src/references/blackhole-state.md` (§ Write protocol refusal list, plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `src/references/queue-dag.md` (§ `--entity-key` shape note, plus all generated dist trees per `scripts/lib/build/targets.ts`)

## Documentation Impact
- `blackhole-state.md` § Write protocol: add the container-type and issue-key refusals to the guard's fail-closed list.
- `queue-dag.md` § `--entity-key` shape note: say the guard accepts either shape on a first write but refuses a shape change against a live file.

## Task Steps
1. **Test first** (`state-write-guard.test.ts`, extend the existing `ENTITY_SHAPES` `describe.each`): 
   - **AC**: for each of `issues` and `findings`, a live file of the native shape and a same-count `.tmp` of the other container type returns `{ok:false}` with a reason containing both `array` and `object`, even with `allowShrink`. Observed red on current code, green after step 2.
   - **AC**: a `issues` object whose keys are not positive-integer strings (e.g. `"0"`, `"abc"`) is refused, reason names the offending key; `findings` is unaffected.
   - **AC**: first write with no live file and a live file lacking the entity key still pass (no baseline), and all existing tests stay green.
   - **AC**: one CLI test exits 1 with the reason on stderr for the shape swap.
2. **Fix** (`state-write-guard.ts`): add a `containerKind(parsed, entityKey)` returning `'array' | 'object' | null`; reuse it inside `countEntities` (one traversal, no duplicate shape logic). In `validateStateWrite`, after `liveCount` is resolved (live structurally valid) and before the zero/shrink checks, refuse when kinds differ: `${entityKey} container type would change from <live> to <tmp> — ...`. For `issues`, extend the existing `queueEnumError` pass (or a sibling next to it) to refuse object keys not matching `/^[1-9]\d*$/`; skip when the container is an array (already refused by the type check when live is an object). 
   - **AC**: `bun test scripts/lib/state-write-guard.test.ts` passes.
3. **Docs**: update the two references (Touch-Paths) in `src/`, then regenerate only the mirrors via the repo's single documented build step for reference docs; do not run the full build or `verify` locally, CI verifies.
   - **AC**: `grep -c "container type" src/references/blackhole-state.md` >= 1 and each generated `blackhole-state.md` copy listed by `git ls-files` matches `src/` (CI `verify` build-drift check).

## Codebase Conventions
- Refusal reasons are plain strings returned as `{ok:false, reason}`; CLI exit 1 prints reason to stderr (unchanged).
- Tests use `makeTempDir` and the `ENTITY_SHAPES` `describe.each`; extend it, do not add a parallel harness.
- Existing queue fixtures use keys `"1".."n"`, which satisfy the key rule.

## Scout / Risk
- Risk: a live `issues` that is itself an array (degenerate) → current behaviour "no baseline" applies only when live count is null; a live array with an object `.tmp` would now be refused, which is intended (shape must not change either way). Stop condition: if a real campaign queue ever legitimately needs a shape migration, `scripts/queue-migrate.ts` must install it, not this guard; if it does, abort and file an issue.
- Local verification: only `bun test scripts/lib/state-write-guard.test.ts` through `with-test-lock` after MemAvailable >= 2500 MB.
