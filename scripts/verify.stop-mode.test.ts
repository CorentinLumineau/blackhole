import { describe, expect, test } from 'bun:test';
import { read } from './checks/check-utils.ts';
import {
  assertNoOrphanedInFlight,
  checkStopModeWiring,
  findUncitedFlushedMention,
  runChecks,
} from './checks/stop-mode.check.ts';

// Issue #478 — stop mode: drain default + --abandon tier (#476 leg A).
// V-STOP-01: pure invariant — no queue.json in-flight entry names a worker outside the
// currently-running set. V-STOP-02: static conformance — SKILL.md/phase-stop.md/
// checkpoint-protocol.md wiring for the stop mode (see stop-mode.check.ts for the full contract).

describe('assertNoOrphanedInFlight', () => {
  test('passes when there are zero in-flight entries', () => {
    const result = assertNoOrphanedInFlight([], []);
    expect(result).toEqual({ id: 'V-STOP-01', ok: true });
  });

  test('passes when every in-flight entry names a currently-running worker', () => {
    const result = assertNoOrphanedInFlight(
      [
        { issue: 298, worker: 'implementer-298' },
        { issue: 301, worker: 'reviewer-301' },
      ],
      ['implementer-298', 'reviewer-301']
    );
    expect(result).toEqual({ id: 'V-STOP-01', ok: true });
  });

  test('fails and names the offending issue/worker when an in-flight entry has no running worker', () => {
    const result = assertNoOrphanedInFlight(
      [
        { issue: 447, worker: 'implementer-447' },
        { issue: 465, worker: 'reviewer-465' },
      ],
      ['reviewer-465']
    );
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-STOP-01');
    expect(result.detail).toContain('#447');
    expect(result.detail).toContain('implementer-447');
    expect(result.detail).not.toContain('#465');
  });
});

describe('checkStopModeWiring() against the real src/ files', () => {
  test('returns ok: true once Tasks 1-6 land', () => {
    const result = checkStopModeWiring();
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});

describe('runChecks()', () => {
  test('returns exactly one V-STOP-02 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-STOP-02');
  });
});

// Issue #491 — stop --now leg A: worker-side cooperation protocol. checkStopModeWiring() is
// extended (not a new check function — EXPECTED_CHECK_COUNT stays 53) to also verify the third
// tier's static wiring: phase-stop.md documents the tier and cites worker-schemas.md for the
// ask; worker-schemas.md documents the ask itself.
describe('checkStopModeWiring() — stop --now leg A wiring (issue #491)', () => {
  test('phase-stop.md documents the stop --now tier and cites worker-schemas.md for the ask', () => {
    const phaseStop = read('src/references/phase-stop.md');
    expect(phaseStop).toContain('stop --now');
    expect(phaseStop).toContain('worker-schemas.md');
  });

  test('worker-schemas.md documents the Flush request (the ask), not the partial-return response', () => {
    const workerSchemas = read('src/references/worker-schemas.md');
    expect(workerSchemas).toContain('Flush request');
  });

  test('checkStopModeWiring() still returns ok: true once the stop --now tier lands', () => {
    const result = checkStopModeWiring();
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});

// Issue #492 — stop --now leg B: `flushed` is now a real, emitted value (no longer reserved).
// findUncitedFlushedMention() replaces the pre-#492 "reservation note" invariant with a
// "citation" invariant — EVERY `flushed` mention must cite #492 nearby. This is a universal
// check (iterates every occurrence, each re-checked against its own citation window), not an
// existential one (a single whole-file `.test()` that a lone cited mention would satisfy while
// leaving other, uncited mentions undetected — the exact defect a prior version of this helper
// had).
describe('findUncitedFlushedMention() (issue #492)', () => {
  test('flags a `flushed` mention with no nearby #492 citation', () => {
    expect(findUncitedFlushedMention('stop_kind: `flushed` | `killed` | `null`')).toBe(true);
  });

  test('does not flag a `flushed` mention that cites #492 within 80 characters', () => {
    expect(findUncitedFlushedMention('`flushed` is a real value now (issue #492)')).toBe(false);
  });

  test('does not flag content with no `flushed` mention at all', () => {
    expect(findUncitedFlushedMention('stop_kind: `drained` | `killed` | `null`')).toBe(false);
  });

  test('flags a `flushed` mention whose #492 citation is more than 80 characters away', () => {
    const farCitation = `flushed${'x'.repeat(90)}#492`;
    expect(findUncitedFlushedMention(farCitation)).toBe(true);
  });

  test('flags content with one cited and one uncited `flushed` mention (universal, not existential)', () => {
    const mixed = '`flushed` is a real value now (issue #492). Later, `flushed` appears again with no citation.';
    expect(findUncitedFlushedMention(mixed)).toBe(true);
  });

  test('does not flag content where every `flushed` mention has its own nearby #492 citation', () => {
    const allCited = '`flushed` (issue #492) appears here. Later, `flushed` (issue #492) appears again.';
    expect(findUncitedFlushedMention(allCited)).toBe(false);
  });

  test('checkpoint-protocol.md and phase-stop.md both cite #492 near every `flushed` mention', () => {
    expect(findUncitedFlushedMention(read('src/references/checkpoint-protocol.md'))).toBe(false);
    expect(findUncitedFlushedMention(read('src/references/phase-stop.md'))).toBe(false);
  });
});
