---
type: plan
status: completed
completedAt: 2026-07-06
review_trigger: "on milestone completion"
created: 2026-07-06
last_updated: 2026-07-06
plan_base_commit: 015e7cc
pr: TBD — patched by git-pr
related:
  - documentation/architecture/retrospective-blackhole.md
  - documentation/audits/architecture-coherence.md
initiative: blackhole-scoped-extraction
milestone: 1 of 3 (Identity SSOT)
track: quick
---

## Completion

- **status**: completed
- **completedAt**: 2026-07-06
- **pr**: TBD — patched by git-pr

### Shipped

- `scripts/project-identity.ts` — new module, `readProjectIdentity()` + module-level `projectIdentity` singleton, reading `name`/`version`/`description` live from `package.json`, exposing `homepage`/`repository`/`keywordsBase` as constants.
- `scripts/project-identity.test.ts` — 5 unit tests (TDD, written first).
- `scripts/build.ts` wired: `buildGeminiPluginManifest`, `buildCodexPluginManifest`, `buildCodexMarketplace`, `main()`'s inline `pluginMeta`/`marketplaceJson` all read identity from the new module; `build.ts`'s own pre-existing inline `package.json` read eliminated (delegates to `project-identity.ts` — a stricter fix than literally required, per Task 1's acceptance criteria wording).
- `scripts/build.test.ts` extended with 4 new assertions covering previously-untested `description`/`homepage`/`repository`/`keywords` derivation, plus 2 new describe blocks for the extracted Claude manifest builders.
- `scripts/build.ts`: extracted `main()`'s inline `pluginMeta`/`marketplaceJson` construction into exported `buildClaudePluginManifest`/`buildClaudeMarketplace` functions (review-loop fix, V-TEST-01 HIGH — closes the one code path that previously had no unit-level regression guard, only full-build coverage).
- Verified byte-for-byte identical output across all 6 generated manifest files pre/post change (re-verified after the review-fix); `bun test` 158/158 pass; `bun run verify` 18/18 pass.

### Progress Log

- **2026-07-06**: Milestone completed in one session. All 6 tasks done. Both `[NEEDS CLARIFICATION]` markers (package.json field migration, owner.name scope) dismissed per user confirmation — deferred to a future milestone if ever needed, not blocking for this scope.
- **2026-07-06**: Review-fix loop (1 iteration) — 3-agent swarm (quality, security, gates) found 1 HIGH (V-TEST-01: `main()`'s identity wiring untested at unit level) and 1 LOW (V-DRY-04: minor keyword-composition repetition, reviewer recommended against fixing to avoid premature abstraction). HIGH fixed via TDD extraction; LOW accepted as-is. All gates re-verified green post-fix.

# Milestone 1 — Identity SSOT (project-identity.ts)

## Objective

Extract project identity (`name`, `description`, `version`, `homepage`, `repository`, shared
`keywords` suffix) out of `scripts/build.ts`'s hardcoded literals into a single new module,
`scripts/project-identity.ts`, and wire every manifest-builder function that currently embeds the
literal `'blackhole'` string to read from it instead. This fixes the identity-rename OCP axis
(FAIL→PASS per the upstream retrospective) without introducing a general `PlatformTarget`
interface — that broader abstraction was explicitly rejected by convergent adversarial review as
premature for a single-maintainer, zero-incident codebase (see
`documentation/architecture/retrospective-blackhole.md` §3.4). Pareto value 45% / effort 25% —
a small, isolated extraction with an outsized SRP payoff (`build.ts` drops one of its 10 clusters).

This milestone touches `scripts/` tooling only — no `src/`, no compiled-mirror targets, and no
`package.json` schema changes (see Task 1 rationale for why `homepage`/`repository`/keyword-suffix
stay as constants in the new module rather than new `package.json` fields, which would exceed the
initiative's stated file scope).

**Out of scope** (do not touch): the 3 hidden `spawnSync('bun run build')` runtime-coupling
channels in `scripts/verify.ts`; the `author` block in `buildCodexPluginManifest` (name/email/url);
the `owner.name` GitHub-username field in `main()`'s `marketplaceJson` — these are separate
concerns from project identity and are explicitly deferred (see Task 5 marker).

## Task Breakdown

**Dependency order**: Task 1 → {Task 2, Task 3, Task 4, Task 5} → Task 6. Tasks 2–5 all depend on
Task 1 (the identity module must exist first); Task 6 (regression verification) depends on all of
Tasks 1–5 being complete.

### Task 1 — Create `scripts/project-identity.ts`

Add a new module that reads `name`, `version`, and `description` live from `package.json` (reuse
the existing `readPkg()`-style read already established in `scripts/release.ts:38-40` — do not
introduce a third `JSON.parse(fs.readFileSync(...package.json))` pattern; either import/reuse that
helper or mirror its exact signature and return shape), and additionally exports `homepage`,
`repository`, and a shared `keywordsBase` array as named constants sourced from their current
literal values in `scripts/build.ts` (`https://github.com/CorentinLumineau/blackhole` for both
`homepage` and `repository`; `['native', 'workflows', 'skills']` for `keywordsBase`). These three
are NOT sourced from `package.json` because `package.json` doesn't carry them today and adding them
there is outside this milestone's stated file scope (`scripts/project-identity.ts`,
`scripts/project-identity.test.ts`, `scripts/build.ts` only) — centralizing them as constants in
the new module still gives `build.ts` exactly one place to read every identity value from, which is
the OCP fix this milestone targets. Follow the `read*` naming convention used elsewhere in
`scripts/*.ts` for any exported I/O function (e.g. `readProjectIdentity()`).

[NEEDS CLARIFICATION: should `homepage`/`repository`/`keywordsBase` eventually become real
`package.json` fields in a later milestone, or remain constants maintained inside
`project-identity.ts` indefinitely? Milestone 2/3 scope docs don't address this.]

**Acceptance criteria**: module exports `name`, `version`, `description`, `homepage`,
`repository`, `keywordsBase`; `name`/`version`/`description` are read live from `package.json`
(verified in Task 2 by asserting the export tracks a mutated `package.json` fixture, not a
hardcoded copy); grep for `JSON.parse(fs.readFileSync` across `scripts/project-identity.ts` and
`scripts/release.ts` shows at most the one existing occurrence in `release.ts` plus (if not
reused) exactly one new occurrence in `project-identity.ts` — never a second independent
implementation of the same read living in both files without one delegating to the other.

### Task 2 — Write `scripts/project-identity.test.ts`

Unit tests, written before Task 1's implementation is considered done (TDD): (a) exported
`name`/`version`/`description` match the real `package.json`'s current values; (b) `homepage` and
`repository` are non-empty strings starting with `https://`; (c) `keywordsBase` deep-equals
`['native', 'workflows', 'skills']`; (d) the module performs no filesystem writes (read-only).

**Acceptance criteria**: `bun test scripts/project-identity.test.ts` passes with ≥1 assertion per
exported field; test run produces zero side-effect files.

### Task 3 — Wire `buildGeminiPluginManifest` to `project-identity.ts`

Replace the hardcoded `name: 'blackhole'` (`scripts/build.ts:229`) and
`keywords: ['blackhole', 'gemini', 'native', 'workflows', 'skills']` (`scripts/build.ts:234`) with
values built from the identity module — keywords becomes
`[identity.name, 'gemini', ...identity.keywordsBase]`. `scripts/build.test.ts:81-91` already has a
`describe('buildGeminiPluginManifest', ...)` block asserting `manifest.name` and
`manifest.keywords[0]` equal `'blackhole'` — this is the pre-existing characterization test acting
as the regression guard; extend it with an assertion on `manifest.description` matching
`identity.description` and `manifest.keywords` deep-equaling the identity-composed array (these
fields aren't currently asserted).

**Acceptance criteria**: `buildGeminiPluginManifest('1.2.3')` output is unchanged (existing test at
`build.test.ts:81-91` still passes, plus the new description/keywords assertions pass); `bun run
build --gemini` completes and `assertGeminiTree` still passes.

### Task 4 — Wire `buildCodexPluginManifest` to `project-identity.ts`

Replace the hardcoded `name` (`scripts/build.ts:238`), `homepage` (`scripts/build.ts:246`),
`repository` (`scripts/build.ts:247`), and `keywords` (`scripts/build.ts:249`) with `identity.name`,
`identity.homepage`, `identity.repository`, and
`[identity.name, 'codex', ...identity.keywordsBase]` respectively. Leave the `author` block
(name/email/url, `scripts/build.ts:241-245`) untouched — out of scope per the milestone objective's
field set (name/description/keywords/homepage/repository only). The existing test at
`scripts/build.test.ts:195-204` asserts `manifest.name` — extend it with assertions on
`manifest.homepage`, `manifest.repository`, and `manifest.keywords` (currently untested fields).

**Acceptance criteria**: `buildCodexPluginManifest('0.3.0')` output is unchanged (existing test at
`build.test.ts:195-204` plus new homepage/repository/keywords assertions all pass); `bun run build`
(default, Codex enabled) completes and `assertCodexTree` still passes.

### Task 5 — Wire `buildCodexMarketplace` and `main()`'s inline `pluginMeta` / `marketplaceJson`

- `buildCodexMarketplace()` (`scripts/build.ts:268-285`): replace `name: 'blackhole-codex'`
  (`build.ts:269`) with `` `${identity.name}-codex` `` and the nested `plugins[0].name: 'blackhole'`
  (`build.ts:273`) with `identity.name`.
- `main()`'s `pluginMeta` (`scripts/build.ts:553-560`): replace `name: 'blackhole'` and `keywords`
  the same way as Tasks 3/4, using `[identity.name, 'claude-code', ...identity.keywordsBase]`.
- `main()`'s `marketplaceJson` (`scripts/build.ts:566-572`): replace `name:
  'blackhole-marketplace'` with `` `${identity.name}-marketplace` ``. Leave `owner: { name:
  'CorentinLumineau' }` untouched — this is the GitHub org/user identity, a distinct concern from
  project identity and not listed in the milestone objective's field set.

[NEEDS CLARIFICATION: confirm `owner.name` (GitHub username in `marketplaceJson`) is intentionally
out of scope for this SSOT extraction, or should it be folded into `project-identity.ts` as an
`author`/`owner` field in a later milestone alongside the Task 1 clarification on
homepage/repository?]

The existing test at `scripts/build.test.ts:206-214` asserts `marketplace.name` equals
`'blackhole-codex'` — this is the regression guard for that half of the task; no test currently
covers `main()`'s inline `pluginMeta`/`marketplaceJson` objects (they're only exercised indirectly
via `bun run build`'s file output), so add a minimal assertion — e.g. read back
`.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` after a build run and assert
their `name`/`keywords` fields — if no such coverage exists today in
`scripts/verify.build.test.ts` or elsewhere.

**Acceptance criteria**: `buildCodexMarketplace()` output is unchanged (existing test at
`build.test.ts:206-214` still passes); a full `bun run build --all` completes without error and the
generated `.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` files contain
`name: 'blackhole'` / `name: 'blackhole-marketplace'` respectively, unchanged from pre-refactor
output.

### Task 6 — Regression verification (full build + test suite)

Run `bun run build --all` (covers Gemini + Codex + Claude + Cursor + skills.sh targets) and diff
the generated manifest files (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
`.codex-plugin/plugin.json`, `codex-marketplace.json`, `.gemini-plugin/plugin.json`,
`plugins/blackhole/plugin.json`) against a pre-change snapshot (e.g. `git stash` the diff, build
once on `HEAD`, restore the diff, build again, `diff` the two output trees) to confirm byte-for-byte
identical output — this is a pure refactor, no behavior change is expected anywhere in this
milestone. Then run the full test suite and the project's own verify script.

**Acceptance criteria**: zero diff between pre-change and post-change generated manifest JSON
files; `bun test` exits 0 (full suite, including the new `project-identity.test.ts` and the
extended assertions in `build.test.ts`); `bun run verify` exits 0.
