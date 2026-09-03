import { describe, expect, test } from 'bun:test';
import { findDuplicatedResolutionClauses, runChecks } from './checks/gate-resolution-citation.check.ts';

// Issue #723: nine call sites across six files copy-pasted `config-template.md`'s
// gate-resolution clause verbatim instead of citing it by reference, and one of the nine
// (reviewer.md §25) already silently drifted (dropped its `, issue #477` suffix). This check
// scans for the duplicated clause pattern outside its one canonical home so a tenth copy fails
// `bun run verify` by name instead of drifting again.

describe('findDuplicatedResolutionClauses', () => {
  test('detects the single-line clause with no backtick-wrapped field names', () => {
    const files = {
      'src/agents/orchestrator.md':
        'Inert when `docs_governance.enabled` does not resolve to `true` (absent block, absent field, or explicit `false` — SSOT: `config-template.md`\'s `docs_governance.enabled` row, issue #477), `companion_files` is `false`.',
    };
    const hits = findDuplicatedResolutionClauses(files);
    expect(hits).toEqual([{ file: 'src/agents/orchestrator.md', line: 1 }]);
  });

  test('detects the backtick-wrapped variant', () => {
    const files = {
      'src/references/doc-governance.md':
        'Gated by `docs_governance.write_governance`: inert when `docs_governance.enabled` does\nnot resolve to `true` (absent `docs_governance` block, absent `enabled` field, or\nexplicit `enabled: false` — SSOT: `config-template.md`\'s `docs_governance.enabled` row,\nissue #477) or `docs_governance.write_governance === false`.',
    };
    const hits = findDuplicatedResolutionClauses(files);
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe('src/references/doc-governance.md');
    // The clause starts mid-second-line ("not resolve to `true` (absent `docs_governance`
    // block, absent `enabled` field, or...") — line 2, 1-indexed.
    expect(hits[0].line).toBe(2);
  });

  test('detects the clause wrapped across two lines, with the correct 1-indexed line number', () => {
    const files = {
      'src/agents/implementer.md':
        'Line one is filler.\n    Inert when `docs_governance.enabled` does not resolve to `true` (absent block, absent\n    field, or explicit `false` — SSOT: `config-template.md`\'s `docs_governance.enabled` row,\n    issue #477) or `docs_governance.write_governance === false`.',
    };
    const hits = findDuplicatedResolutionClauses(files);
    expect(hits).toEqual([{ file: 'src/agents/implementer.md', line: 2 }]);
  });

  test('clean file with no clause produces zero hits', () => {
    const files = {
      'src/agents/reviewer.md': 'This file discusses gates but never restates the resolution clause verbatim.',
    };
    expect(findDuplicatedResolutionClauses(files)).toEqual([]);
  });

  test('src/references/config-template.md itself is exempt even when it contains the phrase', () => {
    const files = {
      'src/references/config-template.md':
        'an absent `docs_governance` block, a present block with `enabled` unset, and an explicit `enabled: false` all resolve to the same inert state — absent block, absent field, or explicit `false`.',
    };
    expect(findDuplicatedResolutionClauses(files)).toEqual([]);
  });

  test('hunt/parity.md\'s shorter "absent block/`false`" phrasing (no "field") is not a false positive', () => {
    const files = {
      'src/references/hunt/parity.md':
        'absent block/`false` ⇒ this heuristic is inapplicable and the finding is downgraded.',
    };
    expect(findDuplicatedResolutionClauses(files)).toEqual([]);
  });
});

describe('gate-resolution-citation runChecks() against the real tree', () => {
  test('returns one CheckResult entry', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results.map((r) => r.id)).toEqual(['V-GATE-02']);
  });

  // RED until tasks 3-4 (config-template.md Resolution sentences + short-form citation
  // replacements at all 9 sites) land.
  test('passes against the current tree', () => {
    const results = runChecks();
    expect(results[0]).toEqual({ id: 'V-GATE-02', ok: true });
  });
});
