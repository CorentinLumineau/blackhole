---
type: analysis
status: current
created: 2026-09-06
last_updated: 2026-09-06
review_trigger: "on file change"
issue: 869
confidence: 80
computed_at_revision: 1
---

# Analysis: Issue #869 — mechanizing V-code parity against mercure

Scope: evidence only, for the open design question the issue's "Fix direction" #1 begs —
mercure already ships parseable markdown V-code tables, so is a mechanical parity check a
vendored-snapshot diff, a live cross-repo parse, or a wait-for-mercure-to-emit-something? This
note does not choose; it gathers what each option would actually cost. All citations against
mercure are `git -C /Users/morphism/Documents/git/mercure` at local HEAD `d4bfddf7` (2026-08-21
last content touch); all citations against blackhole are `origin/main` at `42daf856`, per the
workspace prohibition (blackhole's own working tree is 20+ commits stale and was not read).

## Conventions Catalog

**What mercure exposes today.** `mercure-plugin/rules/references/` holds 8 files —
`v-codes-ada.md`, `v-codes-architecture.md`, `v-codes-delegation.md`, `v-codes-doc-gov.md`,
`v-codes-quality.md`, `v-codes-security.md`, `v-codes-testing.md`, `v-codes-ux.md` — every one
using the identical 3-column shape `| ID | Severity | Description |` (e.g.
`v-codes-quality.md:5`, `v-codes-security.md:5`, `v-codes-ux.md:5`). This is not a hand-parseable
convention only — mercure already has a generator that consumes it:
`mercure-plugin/scripts/opencode/rule-inliner.js` exports `parseSeverityRows` (line ~113, the
3-column-row regex — matches hyphenated categories and lowercase letter suffixes like
`V-DOC-GOV-01`/`V-UX-04a`) and `loadDomainSeverityMap` (line ~134, reads exactly those 8 files
via `appendVCodeDomainFiles`, lines 39-48). `mercure-enforcement-contract.md`'s
`<!-- SEVERITY-INDEX:START/END -->` fenced block — the "## Severity Index" table blackhole's
own router pass read for its 110-ID count — **is generated output**, not hand-maintained:
`Makefile:383-384`'s `make severity-index` target runs
`node mercure-plugin/scripts/opencode/rule-inliner.js --write-severity-index`, which calls
`loadDomainSeverityMap` → `renderSeverityIndex` → `applySeverityIndex` and writes the result back
into the committed contract (dual-writing a Claude `.md` and a Cursor `.mdc` target,
`rule-inliner.js:150-151`). It is not CI-enforced (no mercure workflow references
`severity-index` or `rule-inliner`), so it can drift from the source tables between manual runs
— but the generator itself is real, committed, and already the source of truth for that index.

Verified live: `node mercure-plugin/scripts/opencode/rule-inliner.js --emit-severity-map` prints
a full `{ "V-ADA-01": "HIGH", ... }` JSON map today — mercure already emits machine-readable
severity data on demand. Two caveats: (1) it is severity-only — `parseSeverityRows`'s regex
captures only `(id, severity)`, discarding the description cell that `parseContract` (used by
`--dry-run`, a separate code path) does capture into a full `{severity, description}` map, but
`--dry-run`'s own output is a summary object (`vcode_count`, `category_count`, `categories[]`,
verified: 106/33), never the full map — no existing CLI flag dumps id→description. (2) it is not
published anywhere blackhole could fetch without invoking the script — no committed JSON
artifact, no CI job wiring it into a release asset (`grep -rn "emit-severity-map"` across
mercure's `.md`/`.yml`/`Makefile` and `.github/workflows/*.yml` finds no CI usage).

**Table-shape consistency.** All 8 files match the identical header exactly — verified by
grepping each file's full `git log -p --follow` history for every added/removed instance of
`| ID | Severity | Description |`: every file shows only additions, zero removals, across its
entire lifetime. `v-codes-architecture.md` alone now holds 12 separate tables sharing that one
header shape, added across 10 different commits (2026-05-04 to 2026-08-14) — every addition
reused the shape rather than varying it.

**What blackhole would need.** The closest existing precedent for "does artifact A agree with
artifact B" is `scripts/checks/audit-modules.check.ts` (V-AUDIT-01): it cross-checks
`src/references/blackhole-vcodes.md`'s table against `src/references/audits/*.md` frontmatter,
using a declared-fact/independent-scan pair (`REVIEWER_AUDIT_MODULE_COUNT`,
`scripts/lib/build/facts.ts:77`) exactly the shape a parity fact (e.g. "last mercure severity
snapshot synced at commit X") would need. But every existing instance of this pattern —
`audit-modules.check.ts`, `VCODE_TABLE_ROW_COUNT` (`facts.ts:31`, blackhole's own 114-row count)
— compares two **blackhole-local** files. There is no existing precedent in this codebase for a
check whose second artifact lives in a different repository.

The nearer precedent for the cross-repo case specifically is
`scripts/checks/parity-matrix.check.ts` (V-PMATRIX-01, ADR-013 D1): it validates only the row
**schema** of `documentation/audits/mercure-parity-matrix.md`
(`id | kind | mechanism | blackhole | status | priority | verified`) — it never reads mercure,
live or vendored, at all. That matrix file's own frontmatter states it directly: "Living,
single-maintainer table... `prj-mercure-sync` is the sole future writer; a self-audit or
reviewer finding a stale row files an issue, it does not edit this file directly"
(`documentation/audits/mercure-parity-matrix.md:16-19`). `.claude/skills/prj-mercure-sync/SKILL.md`
is the mechanism that actually produces the comparison: a maintainer-only skill
(`disable-model-invocation: true`), explicitly **not** part of the campaign runtime — "does not
compile through `src/` and never ships to consumer repos running a blackhole campaign" — that
uses `gh` against `CorentinLumineau/mercure`'s releases/changelog to run periodic manual sweeps.

Reuse candidates for the blackhole-side half of any new check (V-INT-02): `parseVcodeTableRows`
and `expandVcodeTableKey` in `scripts/lib/check-common.ts` (~lines 107-138) already parse
blackhole's own `| Code | Rule | Severity | Primary enforcement site |` table at
`src/references/blackhole-vcodes.md` and expand `/`-grouped rows (`V-ADA-05/06/07`) — this is
exactly what the router pass that produced the "72 shared IDs" claim under review here would
have needed on the blackhole side, and a new check must reuse it rather than reimplement it.

## Architecture Coherence

Four concrete options, evaluated on: what breaks when mercure changes, whether it works with
mercure absent from disk (blackhole's CI), and who must act on divergence.

**(a) Vendor a snapshot of mercure's tables into blackhole, diff at check time.**
Breaks silently — a vendored copy goes stale until someone re-syncs it; this is exactly
`mercure-parity-matrix.md`'s existing model. Works with mercure absent: yes, always — it's a
static blackhole-committed file. Works in CI: yes, unconditionally, no network/filesystem
dependency on mercure. Who acts: a human/skill re-runs the vendoring step on a cadence, matching
`prj-mercure-sync`'s existing pattern — drift is caught only as of the last sync, not
continuously.

**(b) Parse mercure's files live from a configured path.**
This is the option the CI-access question (below) rules out for the leg that matters. Works with
mercure absent: no — the check must either fail open (silently inert whenever the path is
missing, which is every CI run today) or fail closed (blocks every PR when the path is absent,
which is also every CI run today). Neither is acceptable as a merge gate.

**(c) Wait for mercure to emit a dedicated machine-readable artifact** (the issue's literal
"Fix direction" #1 ask, filed against mercure's tracker).
Partially already true: mercure's `rule-inliner.js` already emits machine-readable severity data
today (`--emit-severity-map`, verified above) — the axis that produced 3 of the issue's 4 finding
categories (the severity disagreements). It is not committed or published anywhere, so consuming
it still requires either running mercure's script (needs the repo present) or mercure starting to
publish the output (e.g. as a release asset) — which reduces to the same access question as (b),
not a different one. A genuinely new capability is needed only for description-drift detection,
which the issue does not raise as a separate finding kind.

**Decisive finding — CI access to mercure at all.** Blackhole's `.github/workflows/verify.yml`
and `.github/workflows/release.yml` each run exactly one `actions/checkout@v4` step, on
blackhole itself — zero second-repo checkout, zero submodule, zero `git clone` of mercure
anywhere in either workflow (`grep -niE "checkout|mercure|clone"` across both files finds only
the one self-checkout in each job). `CorentinLumineau/mercure` is a **private** GitHub repository
(`gh repo view CorentinLumineau/mercure` → `"isPrivate": true`), while
`CorentinLumineau/blackhole` is public. Neither workflow file references any `secrets.*` value
at all (`grep -n "secrets\."` = 0 hits in both files) — no cross-repo credential is configured
today. Compounding this: `verify.yml`'s PR-triggered `verify` job runs on ephemeral
`ubuntu-latest` specifically because, per its own inline comment, "pull_request runs
attacker-controllable fork code — never schedule it on the self-hosted runner (public repo)"
(`.github/workflows/verify.yml:24-26`) — and GitHub Actions does not forward repository secrets
to fork-triggered `pull_request` runs at all, by platform design, independent of whether one is
ever added. So even a future PAT/deploy-key secret would not reach exactly the job (`verify` on
`pull_request`) where a parity check would need to run to block a bad merge. The only leg where a
live parse of mercure's files could work at all is the trusted-push path on the self-hosted `mba`
runner — the same physical Mac this investigation ran on, which happens to have a local mercure
clone — but that path runs on `main` after merge, too late to gate the PR that introduced the
drift, and it would silently depend on that one workstation's directory layout.

This finding eliminates option (b) as a PR-blocking gate outright, and undercuts option (c): even
if mercure published new machine-readable output, blackhole's CI still could not fetch it on the
leg that matters, for the identical private-repo/no-secret/fork-PR reasons.

**Uncertainty flagged, not resolved**: issue #869's body states "the mercure-side counterpart is
filed on Gitea" for the rule-inliner.js emission request. The local mercure clone's `origin`
remote is `git@github.com:CorentinLumineau/mercure.git` (verified `git remote -v`), and
`gh repo view CorentinLumineau/mercure` resolves it as a GitHub repo. Whether a separate Gitea
mirror exists elsewhere (a different remote name, a different account) was not discoverable from
this clone alone — flagging the discrepancy rather than resolving it.

## Performance Baselines

Not applicable — this issue concerns cross-repo tooling coupling for a documentation/enforcement
consistency check, not a runtime code path with latency, query-count, or throughput
characteristics to baseline. No number is fabricated in its place.

## What this rules in and out

- **Rules in**: a vendored-snapshot check (option a) is the only option compatible with
  blackhole's actual CI topology — it is the sole option that works identically whether mercure
  is present or absent, on every triggering event including fork PRs — and it is a direct
  extension of the convention already established by `mercure-parity-matrix.md` +
  `prj-mercure-sync` (single-maintainer artifact, periodic manual sync, schema-only automated
  check).
- **Rules out**: option (b), a live parse of mercure from a configured path, as an automated
  PR-blocking gate — `CorentinLumineau/mercure` is a private repo with no cross-repo secret
  configured, and GitHub Actions would not forward such a secret to fork-triggered `pull_request`
  runs regardless. It remains viable only as a maintainer-run local convenience script (the same
  shape `prj-mercure-sync` already is), never as a `bun run verify` gate.
- **Rules out, as literally proposed**: "Fix direction" #1's ask for mercure to "emit it from
  rule-inliner.js" — mercure's `rule-inliner.js` already does this for the severity axis
  (`--emit-severity-map`, verified live) — the exact axis behind 3 of the issue's 4 finding
  categories. The unresolved sliver (description-drift detection) does not require a new mercure
  feature; it could be parsed from mercure's already-4-months-stable 3-column markdown tables
  directly, using the same row shape mercure's own `parseSeverityRows` already relies on.
- **Not resolved here** (Design Track's call): whether the vendored snapshot is refreshed by
  extending `prj-mercure-sync`'s existing sweep (zero new automation, reuses an established
  maintainer workflow) or by a small new script under `scripts/lib/` a maintainer runs by hand
  against a local mercure clone (same result, different trigger) — both are consistent with the
  evidence above; choosing between them is a planning decision this note does not make.
