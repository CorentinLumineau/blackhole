import { describe, expect, test } from 'bun:test';
import { read } from './checks/check-utils.ts';
import {
  assertNoOrphanedInFlight,
  checkStopModeWiring,
  checkUsageGateWiring,
  findSpawnSitesMissingUsageGate,
  findUncitedFlushedMention,
  findUnlistedForbiddenMentions,
  findUsageRuntimeViolations,
  findUsageStopViolations,
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
  test('returns the V-STOP-02 and V-STOP-03 results', () => {
    const results = runChecks();
    expect(results.map((r) => r.id)).toEqual(['V-STOP-02', 'V-STOP-03']);
  });
});

// Issue #491 — stop --now leg A: worker-side cooperation protocol. checkStopModeWiring() is
// extended (not a new check function) to also verify the third tier's static wiring:
// phase-stop.md documents the tier and cites orchestrator-handoff.md for the ask;
// orchestrator-handoff.md documents the ask itself (relocated from worker-schemas.md by
// issue #726 — the section describes what the orchestrator asks of a worker, not a worker
// return schema).
describe('checkStopModeWiring() — stop --now leg A wiring (issue #491)', () => {
  test('phase-stop.md documents the stop --now tier and cites orchestrator-handoff.md for the ask', () => {
    const phaseStop = read('src/references/phase-stop.md');
    expect(phaseStop).toContain('stop --now');
    expect(phaseStop).toContain('orchestrator-handoff.md');
  });

  test('orchestrator-handoff.md documents the Flush request (the ask), not the partial-return response', () => {
    const orchestratorHandoff = read('src/references/orchestrator-handoff.md');
    expect(orchestratorHandoff).toContain('Flush request');
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

describe('findSpawnSitesMissingUsageGate()', () => {
  const site = (content: string) => [{ path: 'src/references/claude-code-native.md', content }];

  test('flags a spawn block that cites pace-gate.ts without usage-budget.ts', () => {
    const out = findSpawnSitesMissingUsageGate(site('Intro.\n\n1. Run `bun run scripts/pace-gate.ts` then spawn.\n'));
    expect(out).toEqual(['src/references/claude-code-native.md: a block cites pace-gate.ts without usage-budget.ts']);
  });

  test('passes when the same block cites both gates', () => {
    expect(findSpawnSitesMissingUsageGate(site('1. Run `scripts/pace-gate.ts` and `scripts/usage-budget.ts`.\n'))).toEqual([]);
  });

  test('a usage-budget.ts mention in another block does not cover the pace-gate.ts block', () => {
    expect(findSpawnSitesMissingUsageGate(site('Run `pace-gate.ts`.\n\nElsewhere `usage-budget.ts`.\n'))).toHaveLength(1);
  });
});

describe('checkUsageGateWiring() against the real src/ files', () => {
  test('returns ok: true', () => {
    const result = checkUsageGateWiring();
    expect(result.detail ?? '').toBe('');
    expect(result).toMatchObject({ id: 'V-STOP-03', ok: true });
  });

  test('the usage stop in the real phase-stop.md drains and never routes to --abandon', () => {
    expect(findUsageStopViolations(read('src/references/phase-stop.md'))).toEqual([]);
  });
});


const NEVER_LIST = ['Never on a usage stop:', '- route to `--abandon`, or kill or abort a worker', '- mark a queue entry `failed` or `blocked`', '- bump `failed_attempts` or any retry counter'].join('\n');

describe('findUnlistedForbiddenMentions()', () => {
  test('forbidden actions inside the one marked list pass', () => {
    expect(findUnlistedForbiddenMentions('Drain, then wake.\n\n' + NEVER_LIST + '\n\nResume later.', 's')).toEqual([]);
  });

  test('a section without the marked list fails, and so does one with two', () => {
    expect(findUnlistedForbiddenMentions('Drain, then wake.', 's')).toEqual(['s has no "Never on a usage stop:" list']);
    expect(findUnlistedForbiddenMentions(NEVER_LIST + '\n\n' + NEVER_LIST, 's')).toEqual(['s has more than one "Never on a usage stop:" list']);
  });

  test('every forbidden action outside the list fails, negated or not', () => {
    for (const text of ['Never `--abandon`.', 'Do not kill workers.', 'No abort.', 'Not `failed`.', 'None `blocked`.', 'No retry counter.', 'Leave `failed_attempts` alone.']) {
      expect(findUnlistedForbiddenMentions(text + '\n\n' + NEVER_LIST, 's')).toHaveLength(1);
    }
  });
});

describe('usage stop bypasses from the re-review are caught on the real files', () => {
  const runtime = read('src/references/orchestrator-runtime.md');
  const phaseStop = read('src/references/phase-stop.md');
  const inject = (content: string, anchor: string, text: string) => {
    expect(content).toContain(anchor);
    return content.replace(anchor, `${anchor} ${text}`);
  };

  test('the real files carry no forbidden action outside their lists', () => {
    expect(findUsageRuntimeViolations(runtime)).toEqual([]);
    expect(findUsageStopViolations(phaseStop)).toEqual([]);
  });

  test('(a) a negation earlier in the clause does not exempt a later verb', () => {
    const row = '| `STOP-CAMPAIGN` |';
    expect(findUsageRuntimeViolations(inject(runtime, row, 'When no reset time is known abandon the campaign.')).length).toBeGreaterThan(0);
    expect(findUsageStopViolations(inject(phaseStop, '6. **Resume**', 'If the window has not reset yet mark the issue failed.')).length).toBeGreaterThan(0);
  });

  test('(b) an em dash does not hide a forbidden verb', () => {
    expect(findUsageStopViolations(inject(phaseStop, '1. **Drain**', 'Never wait — abandon.')).length).toBeGreaterThan(0);
  });

  test('(c) the kill and abort aliases of --abandon are caught', () => {
    expect(findUsageStopViolations(inject(phaseStop, '4. **Arm one wake at `wake_at`**', 'Kill the in-flight workers.')).length).toBeGreaterThan(0);
    expect(findUsageStopViolations(inject(phaseStop, '4. **Arm one wake at `wake_at`**', 'Abort the round.')).length).toBeGreaterThan(0);
  });

  test('(d) the real counter name failed_attempts is caught', () => {
    expect(findUsageStopViolations(inject(phaseStop, '2. **Leave the queue alone**', 'Increment `failed_attempts`.')).length).toBeGreaterThan(0);
  });

  test('(e) a second paragraph under resume step 7 is scanned up to the next heading', () => {
    const bad = runtime.replace('**MUST** complete `recovery-protocol.md` §5', 'On resume, mark each paused issue `failed`.\n\n**MUST** complete `recovery-protocol.md` §5');
    expect(bad).not.toBe(runtime);
    expect(findUsageRuntimeViolations(bad).join('; ')).toContain('resume step 7');
  });

  test('the usage stop still records stopped_by: usage and wake_at', () => {
    expect(findUsageStopViolations(phaseStop.replace(/stopped_by: usage/g, 'stopped_by: x')).join('; ')).toContain('stopped_by: usage');
    expect(findUsageStopViolations('# Phase — Stop\n\n## Drain tier\n')).toEqual(['phase-stop.md missing the ## Usage stop section']);
  });

  test('missing runtime sections fail loudly', () => {
    expect(findUsageRuntimeViolations('# nothing here')).toHaveLength(2);
  });
});

describe('V-STOP-03 follow-ups from the #1213 review', () => {
  const runtime = read('src/references/orchestrator-runtime.md');
  const phaseStop = read('src/references/phase-stop.md');
  const inject = (content: string, anchor: string, text: string) => {
    expect(content).toContain(anchor);
    return content.replace(anchor, `${anchor} ${text}`);
  };

  test('terminate, cancel, TaskStop, give up, drop and mark `closed` are forbidden outside the list', () => {
    const verbs = ['Terminate the workers.', 'Cancel the round.', 'Call TaskStop on each worker.', 'Give up on the issue.', 'Drop the in-flight issue.', 'Mark the issue `closed`.'];
    for (const text of verbs) {
      expect(findUnlistedForbiddenMentions(text + '\n\n' + NEVER_LIST, 's')).toHaveLength(1);
      expect(findUsageStopViolations(inject(phaseStop, '1. **Drain**', text)).length).toBeGreaterThan(0);
      expect(findUsageRuntimeViolations(inject(runtime, '| `STOP-CAMPAIGN` |', text)).length).toBeGreaterThan(0);
    }
  });

  test('an exception word inside the marked list fails', () => {
    for (const item of ['- route to `--abandon`, except mark it `failed`', '- kill a worker unless it is stuck', '- abort a worker, but only when the window is closed', '- mark a queue entry `blocked` other than a stuck one', '- bump `failed_attempts` if the round failed', '- kill a worker once the window resets', '- abort a worker after wake_at', '- mark a queue entry `failed` otherwise', '- kill a worker — the stuck one is fine', '- abort a worker until the reset', '- kill a worker, though a stuck one may go']) {
      const out = findUnlistedForbiddenMentions(NEVER_LIST + '\n' + item, 's');
      expect(out.join('; ')).toContain('exception');
    }
    const bad = phaseStop.replace('- bump `failed_attempts` or any retry counter', '- bump `failed_attempts` or any retry counter, except when the weekly line is crossed');
    expect(bad).not.toBe(phaseStop);
    expect(findUsageStopViolations(bad).join('; ')).toContain('exception');
  });

  test('a sibling heading naming the usage stop is scanned too', () => {
    const sibling = '\n## Usage stop on the weekly line\n\nKill every in-flight worker.\n';
    const bad = phaseStop.replace('\n## Exit Invariants', `${sibling}\n## Exit Invariants`);
    expect(bad).not.toBe(phaseStop);
    expect(findUsageStopViolations(bad).join('; ')).toContain('Usage stop on the weekly line');
  });

  test('a deeper, mixed-case usage stop heading under another ## parent is scanned', () => {
    const lower = phaseStop.replace('\n## Usage stop\n', '\n### Notes on the Usage Stop\n\nAbort the round.\n\n## Usage stop\n');
    expect(lower).not.toBe(phaseStop);
    expect(findUsageStopViolations(lower).join('; ')).toContain('Notes on the Usage Stop: "Abort"');
  });

  test('the main section is the exact `## Usage stop` heading, not an earlier sibling', () => {
    const earlier = phaseStop.replace('\n## Usage stop\n', '\n## Usage stop notes\n\nName `wake_at` in local time.\n\n## Usage stop\n');
    expect(earlier).not.toBe(phaseStop);
    expect(findUsageStopViolations(earlier)).toEqual([]);
  });

  test('a higher-level usage stop heading wrapping the main section does not skip its checks', () => {
    const wrapped = phaseStop.replace('\n## Usage stop\n', '\n# Usage stop overview\n\n## Usage stop\n');
    expect(wrapped).not.toBe(phaseStop);
    expect(findUsageStopViolations(wrapped.replace(/stopped_by: usage/g, 'stopped_by: x')).join('; ')).toContain('`stopped_by: usage`');
    expect(findUsageStopViolations(wrapped.replace(/wake_at/g, 'wake')).join('; ')).toContain('`wake_at`');
    const noList = wrapped.replace('Never on a usage stop:', 'Avoid on a usage stop:');
    expect(findUsageStopViolations(noList)).toContain('usage stop has no "Never on a usage stop:" list');
  });

  test('an earlier `### Usage stop` heading is not taken as the main section', () => {
    const deeper = phaseStop.replace('\n## Usage stop\n', '\n### Usage stop\n\nName `wake_at` in local time.\n\n## Usage stop\n');
    expect(deeper).not.toBe(phaseStop);
    expect(findUsageStopViolations(deeper)).toEqual([]);
  });

  test('a `#` comment inside a fenced block does not end the section', () => {
    const fenced = phaseStop.replace('\n## Exit Invariants', '\n```bash\n# drain first\n```\n\nKill every in-flight worker.\n\n## Exit Invariants');
    expect(fenced).not.toBe(phaseStop);
    expect(findUsageStopViolations(fenced).join('; ')).toContain('"Kill" outside');
  });

  test('a usage stop heading nested in the main section is reported once, not twice', () => {
    const nested = phaseStop.replace('\nNever on a usage stop:', '\n### Usage stop detail\n\nAbort the round.\n\nNever on a usage stop:');
    expect(findUsageStopViolations(nested).filter((e) => e.includes('Abort the round'))).toHaveLength(1);
  });

  test('a clean sibling section needs no list of its own, and the real docs still pass', () => {
    const clean = phaseStop.replace('\n## Exit Invariants', '\n## Usage stop reporting\n\nName `wake_at` in local time.\n\n## Exit Invariants');
    expect(findUsageStopViolations(clean)).toEqual([]);
    expect(findUsageStopViolations(phaseStop)).toEqual([]);
    expect(findUsageRuntimeViolations(runtime)).toEqual([]);
  });
});
