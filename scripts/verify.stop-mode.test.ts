import { describe, expect, test } from 'bun:test';
import { read } from './checks/check-utils.ts';
import {
  assertNoOrphanedInFlight,
  checkStopModeWiring,
  checkUsageGateWiring,
  findSpawnSitesMissingUsageGate,
  findUncitedFlushedMention,
  findUngovernedFailureRoutes,
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

const USAGE_STOP_OK = [
  '# Phase — Stop',
  '',
  '## Usage stop',
  '',
  'Runs the drain tier with `stopped_by: usage` and `wake_at`. Never `--abandon`.',
  '',
  '## Exit Invariants',
  '',
  'Kill every worker via `--abandon`.',
].join('\n');

describe('findUsageStopViolations()', () => {
  test('a usage stop that drains, records stopped_by: usage and wake_at passes', () => {
    expect(findUsageStopViolations(USAGE_STOP_OK)).toEqual([]);
  });

  test('fails when the usage stop routes to --abandon', () => {
    const bad = USAGE_STOP_OK.replace('Never `--abandon`.', 'Then run the `--abandon` tier.');
    expect(findUsageStopViolations(bad).join('; ')).toContain('routes to --abandon');
  });

  test('fails when the section is missing, or omits stopped_by: usage or wake_at', () => {
    expect(findUsageStopViolations('# Phase — Stop\n\n## Drain tier\n')).toEqual(['phase-stop.md missing the ## Usage stop section']);
    expect(findUsageStopViolations(USAGE_STOP_OK.replace('`stopped_by: usage`', 'a stop')).join('; ')).toContain('stopped_by: usage');
    expect(findUsageStopViolations(USAGE_STOP_OK.replace('and `wake_at`', '')).join('; ')).toContain('wake_at');
  });

  test('fails when the usage stop marks a queue entry failed or blocked', () => {
    const bad = USAGE_STOP_OK.replace('Never `--abandon`.', 'Set each issue `status: blocked`.');
    expect(findUsageStopViolations(bad).join('; ')).toContain('failed or blocked');
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

describe('usage stop failure routes: review-round edits are caught', () => {
  const runtime = read('src/references/orchestrator-runtime.md');
  const phaseStop = read('src/references/phase-stop.md');

  test('the real files carry no failure route', () => {
    expect(findUsageRuntimeViolations(runtime)).toEqual([]);
    expect(findUsageStopViolations(phaseStop)).toEqual([]);
  });

  test('(a) the STOP-WORKERS/PACE-WAIT verdict row routed to stop --abandon fails', () => {
    const row = "then run `phase-stop.md` § Usage stop with the verdict's `wake_at`";
    expect(runtime).toContain(row);
    const bad = runtime.replace(row, 'then run `stop --abandon`');
    expect(findUsageRuntimeViolations(bad).join('; ')).toContain('routes to --abandon');
  });

  test('(b) usage-stop step 2 rewritten to mark entries failed and bump the retry counter fails', () => {
    const step2 = /2\. \*\*Leave the queue alone\*\*[\s\S]*?(?=\n3\. )/;
    expect(phaseStop).toMatch(step2);
    const bad = phaseStop.replace(step2, '2. **Leave the queue alone** — Mark each in-flight queue entry `failed` and bump its retry counter.');
    expect(findUsageStopViolations(bad).join('; ')).toContain('failed or blocked or bumps a retry counter');
  });

  test('resume step 7 rewritten to bump the retry counter fails', () => {
    expect(runtime).toContain('no retry counter.');
    const bad = runtime.replace('no retry counter.', 'bump the retry counter.');
    expect(findUsageRuntimeViolations(bad).join('; ')).toContain('retry counter');
  });

  test('missing scanned sections fail loudly', () => {
    expect(findUsageRuntimeViolations('# nothing here').length).toBe(2);
  });
});

describe('findUngovernedFailureRoutes()', () => {
  test('a negation elsewhere in the sentence does not exempt a later clause', () => {
    expect(findUngovernedFailureRoutes('Drain: spawn nothing, let workers finish, then run `stop --abandon`.')).toHaveLength(1);
    expect(findUngovernedFailureRoutes('Do not wait, mark the entry `failed`.')).toHaveLength(1);
  });

  test('a negation that governs its own clause exempts the match', () => {
    expect(findUngovernedFailureRoutes('It is never an abandon: never `--abandon`, never `stop --now`.')).toEqual([]);
    expect(findUngovernedFailureRoutes('None marks a queue entry `failed` or `blocked`. None bumps a retry counter.')).toEqual([]);
  });

  test('matches failed, blocked, retry-counter wording and --abandon', () => {
    for (const text of ['Mark it failed.', 'Set it `status: blocked`.', 'Bump its retry counter.', 'Run --abandon.']) {
      expect(findUngovernedFailureRoutes(text)).toHaveLength(1);
    }
  });
});
