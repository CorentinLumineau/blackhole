import { describe, expect, test } from 'bun:test';
import { expectMarkerContract, expectMarkersSubstantive } from './lib/marker-fixture-test.ts';
import {
  COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS,
  CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS,
  SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS,
  LAUNCH_GATE_REQUIRED_MARKERS,
  checkConfigConfirmationGate,
  runChecks,
} from './checks/config-gate.check.ts';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string): string => readFileSync(join(import.meta.dir, '..', rel), 'utf-8');

// Fixture-level red/green for V-CONFGATE-01, modeled on verify.single-writer.test.ts. The check
// itself reads the real src/ files; these fixtures pin the marker contract independently so a
// marker constant cannot be quietly weakened to make a failing file pass.

const COORDINATOR_FIXTURE_FIXED = `
**Skip steps 1-6 only on routine resume** — i.e. when config.json already exists.

**Routine resume confirmation gate** — when the mode is \`run\`, run the launch gate in
\`references/launch-gate.md\` before spawning or resuming the orchestrator.

- **Fail closed on docs_governance drift**: STOP if the spawn text disagrees with config-summary.

This confirmation fires on \`run\` mode only — status and the per-phase modes are unaffected.
`;

const LAUNCH_GATE_FIXTURE_FIXED = `
# Launch Gate

Run \`bun run status --summary --json\`, print the table, then one Accept / Adjust per section.
Record the probe with \`scripts/status-probe.ts record\`; it writes \`last_probe\`.
Print-only mode asks nothing and never waits.
`;

const LAUNCH_GATE_FIXTURE_STALE = `
# Launch Gate

Print the raw config, then Proceed or Reconfigure.
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

  test('launch-gate.md must carry the summary, per-section choice, probe and print-only clause', () => {
    expectMarkerContract(LAUNCH_GATE_FIXTURE_FIXED, LAUNCH_GATE_FIXTURE_STALE, LAUNCH_GATE_REQUIRED_MARKERS);
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
      LAUNCH_GATE_REQUIRED_MARKERS,
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

// Each file the check reads, swapped one at a time for a copy missing one marker: the check
// must fail and name that file and marker. This is what proves the real-tree pass is not vacuous.
describe('config-gate check fails on the real files with one marker removed', () => {
  const realFiles = (): Record<string, string> => ({
    'src/agents/coordinator.md': read('src/agents/coordinator.md'),
    'src/references/launch-gate.md': read('src/references/launch-gate.md'),
    'src/references/claude-code-native.md': read('src/references/claude-code-native.md'),
    'src/SKILL.md': read('src/SKILL.md'),
  });

  test('launch-gate.md without last_probe fails', () => {
    const files = realFiles();
    files['src/references/launch-gate.md'] = files['src/references/launch-gate.md'].replaceAll('last_probe', 'probe');
    const result = checkConfigConfirmationGate(files);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('launch-gate.md missing "last_probe"');
  });

  test('coordinator.md without the launch-gate.md pointer fails', () => {
    const files = realFiles();
    files['src/agents/coordinator.md'] = files['src/agents/coordinator.md'].replaceAll('launch-gate.md', 'a gate');
    const result = checkConfigConfirmationGate(files);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('coordinator.md missing "launch-gate.md"');
  });

  test('the unmodified real files pass', () => {
    expect(checkConfigConfirmationGate(realFiles())).toEqual({ id: 'V-CONFGATE-01', ok: true });
  });
});
