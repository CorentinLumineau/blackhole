import { read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers } from '../lib/check-common.ts';

// ADR-007 T5/R2' — config-gate.check.ts: matches verify.config-gate.test.ts.
//
// V-CONFGATE-01: the routine-resume campaign-config confirmation gate must be documented at ALL
// THREE campaign entry paths, because each one can reach `run` or `catchup` mode without passing through the
// others:
//
//   Pattern B — coordinator.md § Bootstrap preflight (coordinator spawns background orchestrator)
//   Pattern C — claude-code-native.md (main chat IS the orchestrator; NO coordinator exists)
//   Pattern A — SKILL.md Phase 0 (legacy direct `/blackhole run` in a single session)
//
// Documenting the gate in only one of them silently reopens the bypass hole on the other two.
// The routine-resume gate's own body (summary, per-section Accept/Adjust, status-page probe,
// print-only clause) lives once in launch-gate.md; coordinator.md carries the pointer to it.
// Marker-based content assertion, modeled on agents.check.ts's V-GATE-01 — a prose convention alone
// is not regression-detectable, a required-substring check is.

export const COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS = [
  'Routine resume confirmation gate',
  'launch-gate.md',
  'Fail closed on docs_governance drift',
  'run` and `catchup` modes only',
];

export const LAUNCH_GATE_REQUIRED_MARKERS = [
  'campaign-status.ts --summary',
  'Accept / Adjust',
  'status-probe.ts record',
  'last_probe',
  'Print-only mode',
  'never waits',
  'catchup',
  'Pacing',
];

export const CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS = [
  'owns the Campaign launch configuration gate',
  'routine resume confirmation gate',
  'catchup',
];

export const SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS = [
  'Campaign launch configuration gate',
  'routine resume confirmation gate',
  'modes only',
];

const GATE_MARKERS_BY_FILE: [string, string[]][] = [
  ['src/agents/coordinator.md', COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS],
  ['src/references/launch-gate.md', LAUNCH_GATE_REQUIRED_MARKERS],
  ['src/references/claude-code-native.md', CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS],
  ['src/SKILL.md', SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS],
];

// `files` maps a repo-relative path to its content; a path it omits is read from the tree.
export const checkConfigConfirmationGate = (files: Record<string, string> = {}): CheckResult => {
  const errors = GATE_MARKERS_BY_FILE.flatMap(([file, markers]) =>
    findMissingGateMarkers(files[file] ?? read(file), markers).map(
      (m) => `${file.split('/').pop()} missing "${m}"`,
    ),
  );

  if (errors.length) return { id: 'V-CONFGATE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-CONFGATE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkConfigConfirmationGate()];
