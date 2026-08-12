import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateStateWrite } from '../state-write-guard.ts';
import { buildPartialFlushNotes } from './partial-ingest.ts';
import { validateWorker } from './validate.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const fixturePath = path.join(root, 'fixtures/worker-json/implementer-partial.json');

describe('buildPartialFlushNotes', () => {
  test('formats the partial-flush notes string', () => {
    expect(buildPartialFlushNotes('implement', 'blackhole/issue-492', 'pushed', 'Open PR.')).toBe(
      'partial-flush:implement:branch=blackhole/issue-492:disposition=pushed:remaining=Open PR.',
    );
  });

  test('renders branch: null as branch=none', () => {
    expect(buildPartialFlushNotes('plan', null, 'clean', 'Finish the plan.')).toBe(
      'partial-flush:plan:branch=none:disposition=clean:remaining=Finish the plan.',
    );
  });

  test('strips newlines from work_remaining', () => {
    const withNewlines = 'Open PR.\nRun lint.\r\nWrite description.';
    const notes = buildPartialFlushNotes('implement', 'blackhole/issue-492', 'pushed', withNewlines);
    expect(notes).toBe(
      'partial-flush:implement:branch=blackhole/issue-492:disposition=pushed:remaining=Open PR. Run lint. Write description.',
    );
    expect(notes).not.toContain('\n');
    expect(notes).not.toContain('\r');
  });
});

describe('partial-result end-to-end: validation into queue mutation (issue #492)', () => {
  test('a valid implementer partial return validates, builds notes, and is a valid queue write', () => {
    const data = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

    // Step 1: the return validates cleanly against the schema built in this issue.
    expect(validateWorker('implementer', data)).toEqual([]);

    // Step 2: build the `notes` string the orchestrator's ingest procedure records
    // (`orchestrator-runtime.md` § Partial-result ingest step 2).
    const notes = buildPartialFlushNotes(
      data.phase_reached,
      data.partial_result.branch,
      data.partial_result.worktree_disposition,
      data.partial_result.work_remaining,
    );
    expect(notes).toBe(
      'partial-flush:implement:branch=blackhole/issue-492:disposition=pushed:' +
        'remaining=Open PR, run lint, write PR description.',
    );

    // Step 3: apply the ingest procedure's step 1/2 by hand to a minimal in-memory
    // queue.json-shaped object — phase stays at phase_reached, status becomes blocked,
    // notes carries the built string.
    const liveQueue = { issues: { '492': { phase: 'plan', status: 'in-flight', notes: null } } };
    const mutatedQueue = {
      issues: {
        '492': {
          phase: data.phase_reached,
          status: 'blocked',
          notes,
        },
      },
    };
    expect(mutatedQueue.issues['492'].phase).toBe('implement');
    expect(mutatedQueue.issues['492'].status).toBe('blocked');

    // Step 4: run the mutated queue through the write-guard's shape checks
    // (`blackhole-state.md` § Write protocol) — entity count unchanged, `issues` key present.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'partial-ingest-test-'));
    try {
      const livePath = path.join(tmpDir, 'queue.json');
      const tmpPath = path.join(tmpDir, 'queue.json.tmp');
      fs.writeFileSync(livePath, JSON.stringify(liveQueue), 'utf-8');
      fs.writeFileSync(tmpPath, JSON.stringify(mutatedQueue), 'utf-8');

      const result = validateStateWrite({ tmpPath, livePath, entityKey: 'issues' });
      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('a malformed partial return (empty work_done) fails validation before any queue mutation is attempted', () => {
    const invalidPath = path.join(root, 'fixtures/worker-json/implementer-partial-missing-work-done.json');
    const data = JSON.parse(fs.readFileSync(invalidPath, 'utf-8'));

    const errors = validateWorker('implementer', data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('work_done'))).toBe(true);
  });
});
