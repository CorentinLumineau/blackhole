import { describe, expect, test } from 'bun:test';
import { findMissingGateMarkers } from './checks/agents.check.ts';
import {
  COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS,
  CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
  SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS,
} from './checks/config-gate.check.ts';

// Fixture-level red/green for V-CONFGATE-01, modeled on verify.single-writer.test.ts. The check
// itself reads the real src/ files; these fixtures pin the marker contract independently so a
// marker constant cannot be quietly weakened to make a failing file pass.

const COORDINATOR_FIXTURE_FIXED = `
**Skip steps 1-6 only on routine resume** — i.e. when config.json already exists.

**Routine resume confirmation gate** — before spawning or resuming the orchestrator, print
\`renderConfigSummary\` (\`scripts/campaign-status.ts\`), then \`AskQuestion\`:
"Proceed with this config (default)" | "Reconfigure". On Reconfigure, run steps 1-6 from step 1.
This confirmation gate fires on \`run\` mode only — status and the per-phase modes are unaffected.
`;

const COORDINATOR_FIXTURE_STALE = `
**Skip steps 1-6 only on routine resume** — i.e. when config.json already exists AND none of the
three conditions above hold. This carve-out is the ONLY skip condition.
`;

const CLAUDE_NATIVE_FIXTURE_FIXED = `
## Bootstrap gate ownership

On Pattern C the foreground orchestrator owns the Campaign launch configuration gate — including
the routine resume confirmation gate — for every \`run\`-mode turn, before its first fan-out.
`;

const CLAUDE_NATIVE_FIXTURE_STALE = `
## Foreground state ownership

All queue.json and findings-ledger.json mutations happen in the foreground orchestrator.
`;

const SKILL_FIXTURE_FIXED = `
1. **Config** — \`.blackhole/config.json\`. In \`run\` mode this step runs the
   Campaign launch configuration gate: the full 6-step form, or otherwise the lightweight
   routine resume confirmation gate. Gate applies in \`run\` mode only — every other
   mode loads config with no confirm step.
`;

const SKILL_FIXTURE_STALE = `
1. **Config** — \`.blackhole/config.json\` (from \`config-template.md\` in this repo)
`;

describe('V-CONFGATE-01 marker contract', () => {
  test('a coordinator.md carrying the routine-resume gate passes; the pre-change text fails', () => {
    expect(
      findMissingGateMarkers(COORDINATOR_FIXTURE_FIXED, COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS),
    ).toEqual([]);
    expect(
      findMissingGateMarkers(COORDINATOR_FIXTURE_STALE, COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS),
    ).toEqual(COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS);
  });

  test('claude-code-native.md must state Pattern C gate ownership', () => {
    expect(
      findMissingGateMarkers(
        CLAUDE_NATIVE_FIXTURE_FIXED,
        CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
      ),
    ).toEqual([]);
    expect(
      findMissingGateMarkers(
        CLAUDE_NATIVE_FIXTURE_STALE,
        CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
      ),
    ).toEqual(CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS);
  });

  test('SKILL.md Phase 0 must name the gate and scope it to run mode', () => {
    expect(findMissingGateMarkers(SKILL_FIXTURE_FIXED, SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS)).toEqual(
      [],
    );
    expect(findMissingGateMarkers(SKILL_FIXTURE_STALE, SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS)).toEqual(
      SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS,
    );
  });

  // The three entry paths are the whole point of this check — a future edit that drops one of the
  // constants would silently stop guarding that path.
  test('all three entry paths are covered by a non-empty marker set', () => {
    for (const markers of [
      COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS,
      CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
      SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS,
    ]) {
      expect(markers.length).toBeGreaterThan(0);
    }
  });
});
