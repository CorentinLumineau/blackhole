import { read, type CheckResult } from './check-utils.ts';

// Issue #478 — stop mode: drain default + --abandon tier (#476 leg A).

export type InFlightEntry = { issue: string | number; worker: string };

// V-STOP-01: pure invariant — no in-flight entry names a worker outside the running set.
export const assertNoOrphanedInFlight = (
  inFlight: InFlightEntry[],
  runningWorkerIds: string[]
): CheckResult => {
  const running = new Set(runningWorkerIds);
  const orphans = inFlight.filter((e) => !running.has(e.worker));
  if (orphans.length) {
    return {
      id: 'V-STOP-01',
      ok: false,
      detail: orphans.map((o) => `#${o.issue} names ${o.worker} (not running)`).join('; '),
    };
  }
  return { id: 'V-STOP-01', ok: true };
};

// V-STOP-02: static conformance — SKILL.md cites phase-stop.md; phase-stop.md cites
// recovery-protocol.md §9 by reference (never restates its heal-actions steps);
// checkpoint-protocol.md declares the three fields this mode owns; `flushed` (if present at all)
// only appears inside the explicit leg-B reservation sentence.
export const checkStopModeWiring = (): CheckResult => {
  const skill = read('src/SKILL.md');
  const phaseStop = read('src/references/phase-stop.md');
  const checkpoint = read('src/references/checkpoint-protocol.md');
  const workerSchemas = read('src/references/worker-schemas.md');
  const errors: string[] = [];

  if (!skill.includes('phase-stop.md')) errors.push('SKILL.md missing phase-stop.md citation');
  if (!phaseStop.includes('recovery-protocol.md') || !phaseStop.includes('§9')) {
    errors.push('phase-stop.md missing recovery-protocol.md §9 citation');
  }
  if (phaseStop.includes('Clear stale')) {
    errors.push('phase-stop.md restates §9.3 heal-actions steps instead of citing by reference');
  }
  for (const field of ['stopped_by', 'stop_kind', 'worker_state']) {
    if (!checkpoint.includes(field)) errors.push(`checkpoint-protocol.md missing ${field} field`);
  }
  if (checkpoint.includes('flushed') && !/flushed[\s\S]{0,80}#479/.test(checkpoint)) {
    errors.push('checkpoint-protocol.md emits `flushed` without the leg-B reservation note');
  }

  // Issue #491 — stop --now leg A: worker-side ask wiring. Extends this existing check rather
  // than adding a new one, since scripts/lib/build/facts.ts's EXPECTED_CHECK_COUNT is frozen.
  if (!phaseStop.includes('stop --now')) {
    errors.push('phase-stop.md missing the stop --now tier');
  }
  if (!phaseStop.includes('worker-schemas.md')) {
    errors.push('phase-stop.md missing worker-schemas.md citation for the flush ask');
  }
  if (!workerSchemas.includes('Flush request')) {
    errors.push('worker-schemas.md missing the Flush request section');
  }
  if (phaseStop.includes('flushed') && !/flushed[\s\S]{0,80}#492/.test(phaseStop)) {
    errors.push('phase-stop.md emits `flushed` without the leg-B (#492) reservation note');
  }

  if (errors.length) return { id: 'V-STOP-02', ok: false, detail: errors.join('; ') };
  return { id: 'V-STOP-02', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkStopModeWiring()];
