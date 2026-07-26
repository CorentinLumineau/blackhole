import { describe, expect, test } from 'bun:test';
import {
  COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS,
  CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
  SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS,
  runChecks,
} from './checks/config-gate.check.ts';
import { expectMarkerContract, expectMarkersSubstantive } from './lib/marker-fixture-test.ts';

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
    expectMarkerContract(
      COORDINATOR_FIXTURE_FIXED,
      COORDINATOR_FIXTURE_STALE,
      COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS,
    );
  });

  test('claude-code-native.md must state Pattern C gate ownership', () => {
    expectMarkerContract(
      CLAUDE_NATIVE_FIXTURE_FIXED,
      CLAUDE_NATIVE_FIXTURE_STALE,
      CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
    );
  });

  test('SKILL.md Phase 0 must name the gate and scope it to run mode', () => {
    expectMarkerContract(
      SKILL_FIXTURE_FIXED,
      SKILL_FIXTURE_STALE,
      SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS,
    );
  });

  // A marker that is whitespace-only or empty matches every possible file, silently disabling
  // the guard for that entry path while still "passing". Assert the constants are substantive —
  // this is what a bare `.length > 0` check would miss.
  test('no marker is empty or whitespace-only, which would match any file and void the guard', () => {
    for (const markers of [
      COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS,
      CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
      SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS,
    ]) {
      expectMarkersSubstantive(markers);
    }
  });
});

// The fixture tests above pin the marker contract; these exercise the check's own wiring —
// the file paths it reads and the id it returns. A typo'd path or a renamed id would pass every
// fixture test while silently checking nothing.
describe('config-gate runChecks() against the real src/ files', () => {
  test('returns exactly one V-CONFGATE-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-CONFGATE-01');
  });

  test('passes against the current tree — the gate text is present in all three entry paths', () => {
    const [result] = runChecks();
    // On failure, surface which marker/file is missing rather than a bare `false`.
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});
