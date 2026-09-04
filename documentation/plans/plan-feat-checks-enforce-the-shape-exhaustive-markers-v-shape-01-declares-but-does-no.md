---
type: plan
summary: "Plan for issue #762 — enforce the `<!-- shape: exhaustive -->` V-SHAPE-01 marker leg in route-shape.check.ts"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---


# Plan - Issue #762

## Objective

Close the gap PR #758 left open: `scripts/checks/route-shape.check.ts`'s `runChecks()` only
compares `router.ts`'s `validateRoute` required keys against `campaign-status/types.ts`'s `Route`
type. The `<!-- shape: exhaustive -->` markers on the Router examples in
`src/references/worker-schemas.md` and `src/references/queue-dag.md` declare that those fenced
`route` JSON examples are kept in full field-set parity with the router's required keys, but
nothing enforces it — the markers are inert annotations. Add a second `V-SHAPE-01` leg that
parses every `<!-- shape: exhaustive -->`-marked fenced JSON block under `src/references/*.md`
and asserts its embedded `route` object's leaf-key set matches `router.ts`'s required key set
exactly (no `omits:` allowlist — "exhaustive" means full parity, not a declared narrowing).

## Reuse decision (resolves the issue's open question)

Read both `scripts/checks/route-shape.check.ts` and `scripts/checks/inline-schema-drift.check.ts`
before deciding. Conclusion: **extend `route-shape.check.ts`, importing the fenced-JSON-block
parser from `inline-schema-drift.check.ts` — do not move the new leg into
`inline-schema-drift.check.ts`.**

- V-SHAPE-01's declared "Primary enforcement site" in `blackhole-vcodes.md` is
  `scripts/checks/route-shape.check.ts`. The new leg is the same V-code, the same concern (route
  field-set parity), and reuses the same helpers already in that file
  (`parseRequireFieldKeys`, `findRouteShapeDrift`) — it belongs next to them, not split into a
  file that owns a different V-code (V-BRIEF-02).
- `inline-schema-drift.check.ts` excludes `worker-schemas.md` from its own scan
  (`EXCLUDED_REFERENCE_FILES`) because that file is the status-enum SSOT its check validates
  everything else against. The new leg needs to scan `worker-schemas.md` itself (it carries one
  of the two markers) — bolting that onto `inline-schema-drift.check.ts` would require carving a
  file-specific exception into an exclusion list whose entire purpose is the opposite.
- The genuine reuse opportunity the issue flags is real: `inline-schema-drift.check.ts` already
  exports `findFencedJsonBlocks` (fenced ` ```json ` block extraction with line numbers) — a
  generic parsing primitive, not custom to `V-BRIEF-02`. `route-shape.check.ts` imports that
  named export instead of reimplementing fenced-block scanning (`V-INT-02`). No changes to
  `inline-schema-drift.check.ts` are needed for this: `findFencedJsonBlocks` is already a public
  export.
- Precedent for a check file importing a named helper from a sibling check file already exists:
  `adr-watch.check.ts` imports `parseSectionLineCounts` from `content-gates.check.ts`. This is an
  established, accepted pattern in this codebase, not a new one.

## Touch-Paths

- `scripts/checks/route-shape.check.ts` — add the second `V-SHAPE-01` leg
- `scripts/verify.route-shape.test.ts` — add coverage for the new leg; widen the existing
  live-tree assertion so it no longer blind-spots a broken second leg (see Task 2)
- `src/references/blackhole-vcodes.md` — update the V-SHAPE-01 row's description now that the
  exhaustive-marker leg is enforced, plus all generated dist trees per
  `scripts/lib/build/targets.ts` (do not hand-edit `.claude/rules/blackhole-vcodes.md` or any
  other compiled target — run `bun run build` to regenerate them)

`scripts/checks/inline-schema-drift.check.ts` was investigated (see Reuse decision above) but is
**not** a Touch-Path: `findFencedJsonBlocks` is already exported and requires no change to be
imported elsewhere.

## Documentation Impact

`docs_governance.enabled` is `true` in `.blackhole/config.json`. None of the Touch-Paths are
under `documentation/`. `src/references/blackhole-vcodes.md` is a build source (compiles to
`.claude/rules/blackhole-vcodes.md` and the other platform rule targets), not a
`documentation/`-tree doc, so `doc-governance.md`'s search-before-write/lifecycle-frontmatter
obligations don't apply to it. **None — no companion/consumer doc under `documentation/` is
affected; the only doc-shaped artifact touched (`blackhole-vcodes.md`) is itself a declared
Touch-Path, and its dist-tree copies regenerate mechanically via `bun run build`.**

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test scripts/verify.route-shape.test.ts` and
  `bun run verify` before touching any file, to confirm the current V-SHAPE-01 row (single leg)
  passes and record the pre-change pass count. — **AC**: baseline run output quoted in the
  completion evidence; both commands exit 0 before any edit.

- [ ] **Write failing tests for the new leg** (`scripts/verify.route-shape.test.ts`):
  Add fixture snippets and tests *before* touching `route-shape.check.ts`, so they fail for the
  right reason (the new exports don't exist yet):
  - `EXHAUSTIVE_DOC_FULL_PAYLOAD` — a `<!-- shape: exhaustive -->` marker followed by a fenced
    ` ```json ` block shaped like `worker-schemas.md`'s example: a full router-return payload
    (`{ "status": ..., "route": { ... }, ... }`) whose `route` object's field set matches the
    existing `ROUTER_SNIPPET` fixture's required keys exactly (reuse `ROUTER_SNIPPET` from this
    same test file as the parity baseline — don't hand-duplicate the field list a second time).
  - `EXHAUSTIVE_DOC_BARE_FRAGMENT` — same marker, shaped like `queue-dag.md`'s example: the
    fenced block's body is a bare `"route": { ... }` fragment (not wrapped in an outer `{}`,
    hence not valid JSON on its own), same field set as `ROUTER_SNIPPET`.
  - `EXHAUSTIVE_DOC_MISSING_FIELD` — same as the full-payload fixture but with one required key
    (`task_type`) dropped from the `route` object, to prove missing-field drift is caught.
  - `EXHAUSTIVE_DOC_EXTRA_FIELD` — same as the full-payload fixture but with one undeclared key
    (`stray_field`) added to the `route` object, to prove that an "exhaustive" doc example must
    not carry an extra field either (no `omits:` allowlist applies to this leg).
  - `describe('findExhaustiveMarkerBlocks')`: asserts it locates the marker line and pairs it
    with the immediately-following fenced JSON block's body for both the full-payload and
    bare-fragment fixtures; asserts a file whose marker has no following ` ```json ` block
    returns `[]` (nothing to compare, not itself a drift).
  - `describe('parseExhaustiveRouteKeys')`: asserts it extracts the same leaf-key set as
    `parseRequireFieldKeys(ROUTER_SNIPPET)` from both the full-payload and bare-fragment shapes
    (including `confidence.*` expansion); asserts it returns `null` on an unparseable body.
  - `describe('checkExhaustiveMarkerParity (V-SHAPE-01, second leg)')`: compose
    `findExhaustiveMarkerBlocks` + `parseExhaustiveRouteKeys` + the existing `findRouteShapeDrift`
    against `EXHAUSTIVE_DOC_MISSING_FIELD`/`EXHAUSTIVE_DOC_EXTRA_FIELD` to prove drift is reported
    in both directions, and against `EXHAUSTIVE_DOC_FULL_PAYLOAD`/`EXHAUSTIVE_DOC_BARE_FRAGMENT`
    to prove no false positive.
  - Widen the existing `describe('runChecks live tree')` test (currently
    `results.find((r) => r.id === 'V-SHAPE-01')` — a `.find` picks only the first V-SHAPE-01 row,
    blind to a second row) to `results.filter((r) => r.id === 'V-SHAPE-01')`, asserting the
    filtered array has length 2 and every row's `.ok` is `true`. This closes a real coverage gap:
    without this change, a broken second leg would pass the existing live-tree test silently.
  — **AC**: `bun test scripts/verify.route-shape.test.ts` fails at this point (new tests
    reference not-yet-exported names; the widened live-tree test fails because `runChecks()`
    still returns only one `V-SHAPE-01` row).

- [ ] **Implement the second leg in `scripts/checks/route-shape.check.ts`**:
  - Widen the existing `import { read, type CheckResult } from './check-utils.ts';` to also
    import `root`; add `import * as fs from 'fs';`, `import * as path from 'path';`,
    `import { walkMdFilesAbs } from '../lib/check-common.ts';`, and
    `import { findFencedJsonBlocks } from './inline-schema-drift.check.ts';` (V-INT-02 reuse —
    see Reuse decision above).
  - Add `const REFERENCES_DIR = path.join(root, 'src', 'references');` and
    `const EXHAUSTIVE_MARKER = '<!-- shape: exhaustive -->';`.
  - Add `export const findExhaustiveMarkerBlocks = (content: string): { markerLine: number; body: string }[]`:
    scan `content.split('\n')` for lines whose trimmed value equals `EXHAUSTIVE_MARKER`,
    recording each 1-based `markerLine`; call `findFencedJsonBlocks(content)`; for each marker
    line, find the block whose `startLine === markerLine + 2` (marker line, then the fence-open
    line, then the first body line — consistent with `findFencedJsonBlocks`'s existing
    first-body-line `startLine` convention) and pair them; a marker with no matching block is
    dropped (nothing to compare).
  - Add `export const parseExhaustiveRouteKeys = (jsonBody: string): Set<string> | null`:
    `JSON.parse(jsonBody)`; on a parse failure, retry as `JSON.parse(\`{${jsonBody}}\`)` (handles
    a bare `"route": { ... }` fragment that isn't valid JSON by itself — `queue-dag.md`'s shape);
    return `null` if both attempts fail or the result isn't an object. Resolve the route object as
    `'route' in parsed ? parsed.route : parsed` (uniformly covers both the full-payload shape,
    where `route` is nested, and the bare-fragment shape, which becomes `{ route: {...} }` after
    the wrap fallback). Return `null` if the resolved route value isn't an object. Build the leaf
    key set the same way `parseRouteTypeKeys` already does: top-level keys as-is, `confidence`'s
    own keys expanded to `confidence.<field>` (V-INT-01 — one key-shape convention across all
    three parsers in this file; don't invent a second one).
  - Add `const checkExhaustiveMarkerParity = (): CheckResult`: compute `routerKeys` once via the
    existing `parseRequireFieldKeys(read(ROUTER_VALIDATOR_PATH))`; for every `.md` file under
    `walkMdFilesAbs(REFERENCES_DIR)`, read its content, run `findExhaustiveMarkerBlocks`, and for
    each `{ markerLine, body }`: call `parseExhaustiveRouteKeys(body)`; if `null`, push
    `` `${relPath}:${markerLine} exhaustive marker's fenced JSON block failed to parse` ``; else
    call `findRouteShapeDrift(routerKeys, docKeys, new Set())` (empty omits — the marker declares
    full parity, no narrowing allowlist applies to this leg) and push
    `` `${relPath}:${markerLine}: ${blockDrift.join(', ')}` `` for any non-empty result. Return
    `{ id: 'V-SHAPE-01', ok: false, detail: drift.join('; ') }` if anything was pushed, else
    `{ id: 'V-SHAPE-01', ok: true }`.
  - Change `export const runChecks = (): CheckResult[] => [checkRouteShape()];` to
    `[checkRouteShape(), checkExhaustiveMarkerParity()]`.
  — **AC**: `bun test scripts/verify.route-shape.test.ts` passes in full (every test from the
    previous task, plus the pre-existing tests, green).

- [ ] **Update the V-SHAPE-01 row in `src/references/blackhole-vcodes.md`**: replace the current
  wording (which states the exhaustive markers are "declared intent for a future companion
  check, not yet enforced here — tracked as issue #762") with a description covering both legs:
  the router/types parity leg (unchanged) and the new exhaustive-marker leg (every
  `<!-- shape: exhaustive -->`-marked fenced route JSON example under `src/references/*.md` must
  match `router.ts`'s required key set exactly, no `omits:` allowlist). Then run `bun run build`
  to regenerate the compiled dist trees (`.claude/rules/blackhole-vcodes.md` and the other
  platform targets per `scripts/lib/build/targets.ts`) — never hand-edit those. — **AC**:
  `grep -c "tracked as issue #762" src/references/blackhole-vcodes.md` returns `0`; `bun run
  build` exits 0 and leaves no uncommitted diff in a dist tree relative to what the build just
  produced (i.e. the committed dist output matches a fresh build).

- [ ] **Full verification**: Run `bun run verify` (or `bun run scripts/verify.ts`) end to end. —
  **AC**: exit code 0; the printed V-SHAPE-01 lines (now two rows) both show `✓`; `V-BRIEF-02`'s
  row is unchanged (this plan makes no edit to `inline-schema-drift.check.ts`); no new failing
  check appears anywhere else in the output (in particular, no vcodes doc/dist sync check
  regresses from the Task 4 edit).

No sweep/grep-to-zero acceptance criterion appears in this plan — every AC above is either a
fixture-backed unit test or a live-tree assertion scoped to the two files carrying the
`<!-- shape: exhaustive -->` marker today (`worker-schemas.md`, `queue-dag.md`); there is no
repo-wide "drive some grep to zero occurrences" task here, so no scope-path/exemption-clause
statement applies.

## Stop Conditions

- If `parseExhaustiveRouteKeys` cannot parse either live doc's fenced block after Task 3 lands
  (e.g. a future unrelated edit leaves invalid JSON in one of the two marked blocks), the check
  must report `ok: false` with the parse-failure detail — never silently skip the block. Abort
  the implementation task and fix the block's JSON (or the parser, if the block is valid JSON the
  parser mishandles) before proceeding; do not weaken the check to tolerate the failure.
- If widening the `runChecks live tree` test (Task 2) reveals the *existing* router/types leg was
  already failing on the live tree (unlikely — `bun run verify` currently passes — but must be
  checked freshly, not assumed), stop and treat that as a pre-existing regression outside this
  issue's scope: file a separate issue rather than folding an unrelated fix into this PR.
