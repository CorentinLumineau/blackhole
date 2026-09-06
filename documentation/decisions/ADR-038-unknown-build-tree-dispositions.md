---
type: adr
summary: "Dispositions for the three Unknown committed build trees left by the #328 audit — all three kept tracked and reclassified against a live install trace: the two detached root manifests are maintainer-surface (provably off every consumer install path), codex-agents/ is shipped-unreferenced (delivered by the whole-repo Codex install, discovery unconfirmed); README § Antigravity's bun run build prerequisite before ln -s removed as trace-disproven; untracking rejected on Pareto and blast-radius grounds with per-tree revisit conditions recorded"
status: accepted
review_trigger: "on build target change"
created: 2026-09-04
last_updated: 2026-09-04
related:
  - documentation/audits/build-tree-install-resolution.md
  - documentation/decisions/ADR-009-claude-marketplace-bundle-isolation.md
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
---

# ADR-038: Dispositions for the three "Unknown" committed build trees

## Status

Accepted — 2026-09-04.

**Numbering note.** Issue #725's title names this record "ADR-029". That number was already
taken by `ADR-029-bash-write-target-worktree-containment.md` before #725 was filed, so this
record takes the next free number instead. The title's number is a stale label, not a
supersession claim against ADR-029.

## Context

`documentation/audits/build-tree-install-resolution.md` § Classification summary measured every
committed build tree against the install path that resolves it and closed with three rows it
declined to classify:

| Audit row | Tree | Why "Unknown" |
|---|---|---|
| 1b | root `.claude-plugin/plugin.json` | Detached twin of the bundle-co-located manifest; no install path or build comment confirms anything reads it |
| 6 | `codex-agents/` | The one Codex sub-tree with no manifest-level reference; presence asserted only by build/verify checks |
| 8 | root `.gemini-plugin/plugin.json` | Same detached-twin shape as 1b; `scripts/build.ts` calls it "deletable without breaking the other", but no install path is documented as reading it |

The audit was explicit that these are unknown *for lack of evidence available in-repo*, and that
a live install trace — not more reading — is what would settle them. This record supplies that
trace and disposes of all three.

### Live install traces

Run in the campaign container against `a5a7d6f8` (this issue's branch point), Claude Code CLI
`2.1.261`. Neither the Codex CLI nor the Gemini/Antigravity CLI is installed in this container
(`command -v codex` / `command -v gemini` → no), so trace 3 is a manifest-resolution trace, not
an end-to-end product install — its limits are stated with it.

**Trace 1 — Claude Code marketplace install, with and without the root twins.** Two local
clones of the branch point: `clone-full` verbatim, and `clone-noroot` with root
`.claude-plugin/plugin.json` and the whole `.gemini-plugin/` directory deleted. Each was
installed into its own isolated `CLAUDE_CONFIG_DIR` via the exact documented commands:

```
$ claude plugin marketplace add <clone>
√ Successfully added marketplace: blackhole-marketplace (declared in user settings)
$ claude plugin install blackhole@blackhole-marketplace -y
√ Successfully installed plugin: blackhole@blackhole-marketplace (scope: user)
$ claude plugin details blackhole                       # clone-noroot
  Skills (1)  blackhole
  Agents (8)  router, planner, reviewer, investigator, coordinator, implementer, hunter, orchestrator
  Hooks (1)  PreToolUse  (harness-only — no model context cost)
$ diff -r <cfg-full>/plugins/cache/.../0.21.2 <cfg-noroot>/plugins/cache/.../0.21.2
                                                        # no output — 90 files each, 0 differences
```

The installed plugin root is `plugins/blackhole-claude/`'s content, carrying its own co-located
`.claude-plugin/plugin.json`; `codex-agents`, `codex-skills`, `.codex-plugin` and
`.gemini-plugin` are all absent from the cache. Deleting the root twins from the source changes
the installed artifact by **zero bytes**. `claude plugin validate <repo-root>` likewise resolves
`.claude-plugin/marketplace.json`, never the root `plugin.json` beside it.

**Trace 2 — Antigravity/Gemini symlink install on a never-built clone.** A fresh clone with no
`bun run build` ever run in it already carries a complete `plugins/blackhole/` (82 files:
`plugin.json`, `skills/`, `rules/`, `hooks/`, `templates/`), because the tree is committed. The
documented `ln -s` was performed against an isolated fake home and audited by the repo's own
install checker:

```
$ ln -s <fresh-clone>/plugins/blackhole <fakehome>/.gemini/config/plugins/blackhole
$ bun -e 'import {checkGeminiRow} from "./scripts/install-verify.ts"; ...' <fakehome>
{ "platform": "Gemini", "status": "PASS" }
$ ls <fresh-clone>/plugins/blackhole/.gemini-plugin
ls: cannot access ...: No such file or directory
```

Two results: the Antigravity install needs no build step, and root `.gemini-plugin/` is outside
the symlink target, so it is structurally unreachable through the only documented Antigravity
install path.

**Trace 3 — manifest path-reference resolution.** Every relative path key in every shipped
manifest, resolved against the fresh clone:

```
.codex-plugin/plugin.json                     skills = ./codex-skills/            [repo-root: resolves]
.claude-plugin/marketplace.json               plugins.0.source = ./plugins/blackhole-claude [repo-root: resolves]
.claude-plugin/plugin.json                    no relative-path keys
.gemini-plugin/plugin.json                    no relative-path keys
plugins/blackhole/plugin.json                 no relative-path keys
plugins/blackhole-claude/.claude-plugin/plugin.json  no relative-path keys
codex-marketplace.json                        no relative-path keys
codex-agents/ referenced by any shipped manifest?    NO
```

Repo-wide there are exactly two path references between manifests, and neither reaches
`codex-agents/`. This confirms the audit's reading and adds nothing beyond it: absence of a
manifest reference is not evidence of non-consumption, because every sibling target in this repo
(Cursor's `.cursor/agents/`, the Claude bundle's `agents/`) is discovered by directory
convention rather than by a manifest key. Codex's install source is
`{source: "git", url: <repo>}` — the **whole repository**, so `codex-agents/` is delivered to
every Codex consumer whether or not the CLI reads it.

### Maintainer-side consumers found while tracing

The audit asked "which install path resolves this tree?" and got "none" for all three. That is
the wrong question for the two detached twins, which are already first-class inputs to
maintainer tooling:

- `scripts/release.ts` `MANIFEST_PATHS` — the release version-parity gate lists five manifests,
  root `.claude-plugin/plugin.json` and `.gemini-plugin/plugin.json` among them.
- `scripts/checks/gemini-build.check.ts` validates the Antigravity workspace tree shape *against*
  `.gemini-plugin/plugin.json`.
- `scripts/checks/build.check.ts` lists both `.claude-plugin/` and `.gemini-plugin/` as
  build-output prefixes; `scripts/install-hook.sh` stages them.
- `scripts/install-verify.ts` `CODEX_ARTIFACTS` and `scripts/checks/codex-build.check.ts` both
  treat `codex-agents/` as a required artifact.

## Decision

All three trees stay tracked. "Unknown" is retired as a classification and replaced by two
definite ones, so the audit's open question does not silently re-open:

**D1 — root `.claude-plugin/plugin.json`: keep, `maintainer-surface`.** Provably off the
consumer install path (trace 1). Retained as the repo-root plugin identity that the release
version-parity gate and the build-output prefix list already treat as a manifest.

**D2 — root `.gemini-plugin/plugin.json`: keep, `maintainer-surface`.** Same disposition and
same reasoning as D1, with trace 2 supplying the unreachability result in place of trace 1's.

**D3 — `codex-agents/`: keep, `shipped-unreferenced`.** Delivered to every Codex consumer by the
whole-repo git install and required by the repo's own Codex build and install checks. No
evidence of non-consumption exists or can be produced without a Codex CLI, and the failure mode
is asymmetric: removal cannot improve a consumer's install and can silently remove the Codex
agent surface.

**D4 — README § Antigravity drops the `bun run build` prerequisite.** Trace 2 disproves it: the
bundle is committed, so `ln -s` works on a fresh clone. `bun run build` is restated there as
what it actually is — a maintainer step after editing `src/`.

**D5 — README § Installation Paths names the trees each install path resolves.** The Claude
marketplace and Codex stanzas named no tree, which is why `V-TREE-01` carried a standing
`README.md missing: claude-marketplace, codex` advisory while the trees themselves were fine.

**D6 — `documentation/architecture.md` § Committed target trees records the three dispositions**
in the rows that own them, so the registry states the answer at the point of use.

**D7 — no `.gitignore`, `paths.ts`, `isTargetTracked` or `V-TREE-01` change.** Issue #725's third
acceptance criterion is conditional on untracking a tree; that branch does not fire.

**Revisit conditions** (each falsifiable, so a future reader can re-open on evidence rather than
suspicion): D1 — Claude Code ever resolving a repo-root `plugin.json` beside a `marketplace.json`,
or `release.ts` dropping it from `MANIFEST_PATHS`. D2 — an Antigravity install path that reads
repo-root manifests, or `gemini-build.check.ts` no longer validating against it. D3 — a Codex
CLI available to run `codex plugin add blackhole@blackhole-codex` and inspect the installed tree,
or a published Codex plugin schema that enumerates its discovery directories.

## Alternatives Considered

**A — Untrack both detached twins.** Rejected. Gain is one fewer version-carrying manifest per
twin; effort spans `.gitignore`, `release.ts`, `gemini-build.check.ts`, `build.check.ts`,
`install-hook.sh`, `verify.gitignore-scope.test.ts` and the schema fixtures — six files beyond
R-18's declared Touch-Paths. Scored on the campaign's own filing formula
(`Gain × (11 − Effort)`, `V-PARETO-03`): `2 × (11 − 7) = 8`, far below the 30 threshold, for
zero consumer-visible change (trace 1: 0 bytes).

**B — Untrack `codex-agents/`.** Rejected. It rests entirely on absence of a manifest key, which
trace 3 shows is not discriminating in this repo — the sibling agent trees are convention-
discovered too. The tree also ships to consumers via the whole-repo Codex install, so the
downside is unbounded and the upside is eight small YAML files.

**C — Keep the trees but stop generating the twins in `scripts/build.ts`.** Rejected. It carries
alternative A's entire blast radius plus a behavior change to the release version-parity gate,
for the same nil consumer gain.

**D — Leave all three `Unknown` and re-audit later.** Rejected. #328 already deferred this once;
an "Unknown" with no disposition and no revisit condition is exactly the state that let it
stall for four releases. Recording a disposition plus a falsifiable revisit condition costs
nothing and cannot stall.

## Consequences

- The `Unknown (3)` bucket is closed. Every committed build tree now has a definite
  classification and, for the three formerly-unknown ones, a named condition that re-opens it.
- `V-TREE-01`'s standing `README.md missing: claude-marketplace, codex` advisory clears — the
  registry check and the install documentation now agree.
- Antigravity consumers get a correct install: clone, symlink, done. The false `bun run build`
  prerequisite had made the only zero-build-step-install target look like the opposite.
- Nothing is deleted, so no consumer install can regress from this record. The cost is that two
  redundant-looking manifests remain in the tree and must keep passing the release version-parity
  gate — accepted deliberately, priced at 8 on the Pareto scale above.
- `documentation/audits/build-tree-install-resolution.md` § Classification summary still reads
  "Unknown (3)". That file is outside this issue's Touch-Paths and is not edited here; updating
  it to cite this record is filed as a follow-up.
