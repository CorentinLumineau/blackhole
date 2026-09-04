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

// `flushed` is a real, emitted value as of issue #492 (leg B) — EVERY mention in
// checkpoint-protocol.md/phase-stop.md must cite #492 nearby, so the value's legitimizing issue
// stays discoverable at the point of use (this replaces the pre-#492 invariant, which required a
// "still reserved, do not emit" disclaimer instead). Shared between both files' checks below
// (`V-DRY-01`) — the two invariants are structurally identical since #492 landed.
//
// Universal, not existential: an `.exec()`-driven scan over every `flushed` occurrence, each
// re-checked against its own 80-char citation window — never a single whole-file `.test()`,
// which would pass on one cited mention while leaving nine stray uncited ones undetected
// (the exact failure mode this guard exists to catch, once `flushed` stopped being reserved).
const FLUSHED_CITATION_WINDOW = 80;

export const findUncitedFlushedMention = (content: string): boolean => {
  const flushedRe = /flushed/g;
  let match: RegExpExecArray | null;
  while ((match = flushedRe.exec(content))) {
    const window = content.slice(match.index, match.index + 'flushed'.length + FLUSHED_CITATION_WINDOW);
    if (!window.includes('#492')) return true;
  }
  return false;
};

// V-STOP-02: static conformance — SKILL.md cites phase-stop.md; phase-stop.md cites
// recovery-protocol.md §9 by reference (never restates its heal-actions steps);
// checkpoint-protocol.md declares the three fields this mode owns.
export const checkStopModeWiring = (): CheckResult => {
  const skill = read('src/SKILL.md');
  const phaseStop = read('src/references/phase-stop.md');
  const checkpoint = read('src/references/checkpoint-protocol.md');
  const orchestratorHandoff = read('src/references/orchestrator-handoff.md');
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
  if (findUncitedFlushedMention(checkpoint)) {
    errors.push('checkpoint-protocol.md emits `flushed` without citing issue #492');
  }

  // Issue #491 — stop --now leg A: worker-side ask wiring. Extends this existing check rather
  // than adding a new one.
  if (!phaseStop.includes('stop --now')) {
    errors.push('phase-stop.md missing the stop --now tier');
  }
  if (!phaseStop.includes('orchestrator-handoff.md')) {
    errors.push('phase-stop.md missing orchestrator-handoff.md citation for the flush ask');
  }
  if (!orchestratorHandoff.includes('Flush request')) {
    errors.push('orchestrator-handoff.md missing the Flush request section');
  }
  if (findUncitedFlushedMention(phaseStop)) {
    errors.push('phase-stop.md emits `flushed` without citing issue #492');
  }

  if (errors.length) return { id: 'V-STOP-02', ok: false, detail: errors.join('; ') };
  return { id: 'V-STOP-02', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkStopModeWiring()];
