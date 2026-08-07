import { describe, expect, test } from 'bun:test';
import { assertNoOrphanedInFlight, checkStopModeWiring, runChecks } from './checks/stop-mode.check.ts';

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
