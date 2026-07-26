import { read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers } from '../lib/check-common.ts';

// ADR-007 T5/R2' — config-gate.check.ts: matches verify.config-gate.test.ts.
//
// V-CONFGATE-01: the routine-resume campaign-config confirmation gate must be documented at ALL
// THREE campaign entry paths, because each one can reach `run` mode without passing through the
// others:
//
//   Pattern B — coordinator.md § Bootstrap preflight (coordinator spawns background orchestrator)
//   Pattern C — claude-code-native.md (main chat IS the orchestrator; NO coordinator exists)
//   Pattern A — SKILL.md Phase 0 (legacy direct `/blackhole run` in a single session)
//
// Documenting the gate in only one of them silently reopens the bypass hole on the other two.
// Marker-based content assertion, modeled on agents.check.ts's V-GATE-01 — a prose convention alone
// is not regression-detectable, a required-substring check is.

export const COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS = [
  'Routine resume confirmation gate',
  'renderConfigSummary',
  'Proceed with this config',
  'run` mode only',
];

export const CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS = [
  'owns the Campaign launch configuration gate',
  'routine resume confirmation gate',
];

export const SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS = [
  'Campaign launch configuration gate',
  'routine resume confirmation gate',
  'mode only',
];

const checkConfigConfirmationGate = (): CheckResult => {
  const errors = [
    ...findMissingGateMarkers(
      read('src/agents/coordinator.md'),
      COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS,
    ).map((m) => `coordinator.md missing "${m}"`),
    ...findMissingGateMarkers(
      read('src/references/claude-code-native.md'),
      CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
    ).map((m) => `claude-code-native.md missing "${m}"`),
    ...findMissingGateMarkers(read('src/SKILL.md'), SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS).map(
      (m) => `SKILL.md missing "${m}"`,
    ),
  ];

  if (errors.length) return { id: 'V-CONFGATE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-CONFGATE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkConfigConfirmationGate()];
