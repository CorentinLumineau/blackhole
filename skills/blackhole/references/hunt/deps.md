# Hunt Kind: Deps

Scan heuristics, calibration table, and scoring rule for the `deps` hunt kind
(`kaizen.kinds`, [config-template.md](../config-template.md)). Ships the dependency-hygiene hunt
kind named as a deferred seam in ADR-006 § Hunt kinds: audits **unused**, **outdated**, and
**duplicate/redundant** npm/bun dependencies across a campaign repo's package manifests.
`deps` is a pure additive extension: it reuses every existing kaizen mechanism verbatim — the
`V-HUNT-01` `CONFIRMED` verification gate, `V-PARETO-02` scoring, per-wave caps, ledger
idempotency dedup, and the `hunt_state` watermark (`territory.bands_scanned` /
`bands_done`). It introduces no new scoring formula, no new ledger field, no new finding schema,
and no change to `V-HUNT-01`/`V-HUNT-02` gating logic — every candidate passes through the
existing CONFIRMED verification pass (`hunter.md` § Verification pass) and the existing
`phase-loop.md` § Kaizen hunt dispatch 5-step wave protocol unmodified.

## Territory bands

`deps` bands by **package manifest root** — one band per `package.json` / workspace package in
a monorepo (e.g. repo root, `apps/web`, `packages/foo`). Reuse `coverage.md`-style
directory-glob banding on the existing `bands_scanned` / `bands_done` string-array field — no new
field. A wave scans one manifest band at a time; the hunter reads that package's manifest,
lockfile slice, and source tree before reporting any finding for that band.

## Scan heuristics

A `deps` wave audits a campaign repo's declared dependencies for hygiene gaps — never a hunch, and
never a remembered version. Every candidate is read/trace-verified before it is reported
(`hunter.md` § Verification pass): for this kind specifically, `CONFIRMED` means the cited
manifest entry, lockfile line, advisory output, or import-site search was actually read against
current repo state — a plausible-sounding but unread suspicion is `STALE`/not reported.

1. **Unused dependency** — a package listed in `dependencies` / `devDependencies` /
   `peerDependencies` / `optionalDependencies` with **zero** import/require/dynamic-import
   sites in that package's source tree (verify with repo search or the project's package
   manager's unused-dep tooling when present; never guess — if tooling is absent, fall back to
   import-site grep only). Exclude packages that are legitimately config-only (e.g. TypeScript
   types, ESLint plugins referenced only from config files) when the hunter can demonstrate the
   config reference.
2. **Outdated dependency** — a direct dependency whose installed major version lags the latest
   published major, **or** appears in the package manager's security advisory output (`bun audit`,
   `npm audit`, etc.) at **moderate or higher** severity. Hunter must read the actual
   `package.json` + lockfile line and the advisory/outdated output — not a remembered version.
3. **Duplicate / redundant packages** — two or more installed packages whose documented purpose
   substantially overlaps (e.g. two date libraries, `lodash` + `lodash-es` both in direct deps,
   two HTTP clients serving the same layer). `CONFIRMED` requires naming both packages and the
   overlapping concern.

Every finding is read-verified before it is reported: the hunter re-reads the cited manifest
entry, lockfile line, advisory output, or import-site evidence and only reports `CONFIRMED`
findings ([worker-schemas.md](../worker-schemas.md) § Hunter). A candidate whose gap cannot be
confirmed against current repo state is `STALE`, never rounded up to `CONFIRMED`. A `CONFIRMED`
`deps` finding that clears the `Priority >= 30` gate files through the same shared
[filing.md](filing.md) issue-body template every other kind uses — it does not invent its own
issue-body shape.

## Finding file/line convention

Like `parity.md` and `retrospective.md`, this kind's candidates are not naturally
single-file/single-line for every heuristic, so this section fixes a canonical convention per
heuristic — chosen so re-detecting the *same* gap across waves always yields the *same*
`(file, line)` pair and the ledger's dedup check (`findings-ledger.md` § Write protocol, step 3)
correctly collapses re-reports into one row:

| Heuristic | `file` | `line` | Rationale |
|-----------|--------|--------|-----------|
| Unused dependency | The manifest file listing the unused package (`package.json`) | line of the dependency entry | The gap is a declared-but-unreferenced package entry |
| Outdated dependency | The manifest file listing the outdated package | line of the dependency entry | The gap is a stale or advisory-flagged version pin |
| Duplicate / redundant packages | The manifest file listing the first named redundant package | line of that entry | Anchors the finding to one concrete manifest row |

## Severity-term reconciliation note

Like every other hunt kind, the hunter's already-shipped output contract
(`worker-schemas.md` § Hunter, Finding shape) gives `severity` the enum
`LOW | MEDIUM | HIGH | BLOCK`. This kind **reuses that enum as-is** — it does not introduce a
new tier, and it introduces no severity floor the way `bug.md` does. **This kind never assigns
`severity: BLOCK`**: dependency hygiene gaps are not code-breaking defects — they are manifest
and supply-chain maintenance items. `deps` findings go through the normal `Priority >= 30` gate
like every kind other than `bug`'s severity-floor exception (precedent:
`src/references/hunt/bug.md` § Severity floor; matches `parity.md` and `ux-coherence.md`).

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Severity range | Worked example |
|-----------|---------|------------|---------------|-----------------|-----------------|
| Unused dependency | A declared dependency has zero import/require/dynamic-import sites in the package's source tree (config-only exclusions require demonstrated config reference) | 4–6 | 2–4 | LOW–MEDIUM | `packages/ui/package.json` lists `left-pad` in `dependencies` but a repo-wide import grep finds zero references in `packages/ui/src` (illustrative, invented) → gain 5, effort 2, severity MEDIUM → Priority 5 × (11 − 2) = 5 × 9 = 45 (files above the floor) |
| Outdated dependency | A direct dependency's installed major lags the latest published major, or appears in `bun audit`/`npm audit` at moderate+ severity | 5–8 | 2–5 | MEDIUM–HIGH | Root `package.json` pins `axios@0.21.1` while `npm audit` reports a moderate CVE on that line and the lockfile confirms the installed version (illustrative, invented) → gain 7, effort 3, severity HIGH → Priority 7 × (11 − 3) = 7 × 8 = 56 (strong candidate) |
| Duplicate / redundant packages | Two or more direct deps whose documented purpose substantially overlaps in the same manifest band | 3–6 | 3–6 | LOW–MEDIUM | `apps/web/package.json` lists both `moment` and `date-fns` as direct `dependencies` serving the same date-formatting layer (illustrative, invented) → gain 4, effort 3, severity MEDIUM → Priority 4 × (11 − 3) = 4 × 8 = 32 (borderline, files at the floor) |

`gain` and `effort` are each 1–10, matching the hunter output contract (`worker-schemas.md` §
Hunter, Finding shape). Severity never reaches `BLOCK` for this kind, per the reconciliation
note above — the ranges above are per-heuristic calibration bands, not hard values; a hunter
agent picks the specific score within the listed range based on the concrete gap's actual scope.

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending
([blackhole-vcodes.md](../blackhole-vcodes.md), `V-PARETO-02`). This is the **only** scoring
formula for the `deps` kind — no alternate or per-kind formula is introduced, and the
gating notes above are input rules layered on top of the one formula, not a second formula or
a second gating mechanism (ADR-006 § Scoring model verdict: "the formula is sound and stays
unchanged as the single SSOT... mercure's mechanisms as input rules under the one formula, not
as parallel formulas"). Findings scoring below 30 are archived in the ledger and never filed,
per the same rule every other kind follows.
<!-- GENERATED by scripts/build.ts from src/references/hunt/deps.md — do not hand-edit -->
