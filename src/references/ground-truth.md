# Ground Truth — Protocol Drift Detection

This file is a prose pointer, not a source of truth. Machine-checkable facts (the agent roster,
phase names, phase-playbook files, required references, and the V-code table row count) are
declared exactly once in `scripts/build.ts`'s `§ facts` section — never restated here or
anywhere else as a literal.

`scripts/checks/ground-truth.check.ts`'s two-sided facts-conformance check (`V-GROUND-01`)
independently scans the filesystem (`src/agents/`, `src/references/phase-*.md`,
`src/references/blackhole-vcodes.md`'s row count) and compares the scan against the `§ facts`
declaration — two separately-fallible derivations, never collapsed onto one (ADR-007 R1′).
`V-DOCTABLE-01` separately checks that `AGENTS.md`'s roster table and `README.md`'s agent-count
mention still agree with the same declaration; both files stay fully hand-authored, never
generated.

See `scripts/build.ts` § facts and `scripts/checks/ground-truth.check.ts`'s `checkGroundTruth`/
`checkDocTables` for the current declared values and comparison logic. `scripts/verify.ts` itself
is only a thin runner (ADR-007 T5/R2′) that glob-discovers every `scripts/checks/*.check.ts`
domain file — it no longer contains any check logic directly.

`§ facts` also declares five *value vocabularies* — closed sets of enum-shaped strings that agent
prose restates verbatim at many consumption sites, rather than the structural facts above: queue
status, queue notes (its closed gate-value subset), kaizen kinds, platform build targets, and ADR
frontmatter status. `scripts/checks/vocabulary.check.ts`'s registry-driven check (`V-VOCAB-01`)
extends the same two-separately-fallible-derivations discipline to each of them — one hand-authored
declared array per vocabulary in `§ facts`, one independent scan of `src/**/*.md` (or, for ADR
status, `documentation/decisions/**.md`) — never generated from the scan, and never collapsed onto
one derivation path. Adding a sixth vocabulary is a single registry-entry addition, not a new
inline sub-check.
