import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { detectArtifactDrift, type DriftContext, type QueueIssue } from './recovery-drift';

const root = path.resolve(import.meta.dirname, '..');
const fixturesDir = path.join(root, 'fixtures/recovery');

const readIssueFixture = (name: string): QueueIssue =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8'));

describe('detectArtifactDrift router-done', () => {
  const issue = readIssueFixture('router-done-queue.json');
  const context: DriftContext = {
    planExists: false,
    plannerReady: false,
    routeStale: false,
    prOpen: false,
    checkpointWorkers: [{ role: 'router', issue: 42 }],
    notes: issue.notes,
  };

  test('detects router drift with heal to plan phase', () => {
    const result = detectArtifactDrift(42, issue, context);
    expect(result.drift).toBe('router');
    expect(result.heal).toEqual({
      nextPhase: 'plan',
      nextStatus: 'ready',
      clearNotes: true,
      removeWorkers: ['router'],
      skipSpawn: ['router'],
      logNote: 'Recovery: artifact-drift #42 router → plan',
    });
  });

  test('blocks when route needs clarification', () => {
    const clarifying = {
      ...issue,
      route: { ...issue.route!, needs_clarification: true },
    };
    const result = detectArtifactDrift(42, clarifying, context);
    expect(result.heal?.nextStatus).toBe('blocked');
  });

  test('skips router drift when route is stale', () => {
    const result = detectArtifactDrift(42, issue, { ...context, routeStale: true });
    expect(result.drift).toBeNull();
    expect(result.heal).toBeNull();
  });
});

describe('detectArtifactDrift plan-done', () => {
  const issue = readIssueFixture('plan-done-queue.json');
  const context: DriftContext = {
    planExists: true,
    plannerReady: true,
    routeStale: false,
    prOpen: false,
    checkpointWorkers: [{ role: 'planner', issue: 99 }],
    notes: issue.notes,
  };

  test('detects planner drift with heal to implement phase', () => {
    const result = detectArtifactDrift(99, issue, context);
    expect(result.drift).toBe('planner');
    expect(result.heal).toEqual({
      nextPhase: 'implement',
      nextStatus: 'ready',
      clearNotes: true,
      removeWorkers: ['planner'],
      skipSpawn: ['planner'],
      logNote: 'Recovery: artifact-drift #99 planner → implement',
    });
  });

  test('skips planner drift when plan exists but plannerReady is false', () => {
    const result = detectArtifactDrift(99, issue, { ...context, plannerReady: false });
    expect(result.drift).toBeNull();
    expect(result.heal).toBeNull();
  });
});

describe('detectArtifactDrift pr-open', () => {
  const issue = readIssueFixture('pr-open-queue.json');
  const context: DriftContext = {
    planExists: true,
    plannerReady: false,
    routeStale: false,
    prOpen: true,
    checkpointWorkers: [{ role: 'implementer', issue: 99 }],
    notes: issue.notes,
  };

  test('detects implementer drift with heal to review phase', () => {
    const result = detectArtifactDrift(99, issue, context);
    expect(result.drift).toBe('implementer');
    expect(result.heal).toEqual({
      nextPhase: 'review',
      nextStatus: 'ready',
      clearNotes: true,
      removeWorkers: ['implementer'],
      skipSpawn: ['implementer'],
      logNote: 'Recovery: artifact-drift #99 implementer → review',
    });
  });

  test('keeps in-flight when reviewer already spawned', () => {
    const result = detectArtifactDrift(99, issue, {
      ...context,
      checkpointWorkers: [
        { role: 'implementer', issue: 99 },
        { role: 'reviewer', issue: 99 },
      ],
    });
    expect(result.heal?.nextStatus).toBe('in-flight');
  });
});

describe('detectArtifactDrift idempotency', () => {
  test('router-healed state produces no drift', () => {
    const issue = readIssueFixture('router-healed-queue.json');
    const result = detectArtifactDrift(42, issue, {
      planExists: false,
      plannerReady: false,
      routeStale: false,
      prOpen: false,
      checkpointWorkers: [],
      notes: issue.notes,
    });
    expect(result.drift).toBeNull();
    expect(result.heal).toBeNull();
  });

  test('plan-healed state produces no drift', () => {
    const issue = readIssueFixture('plan-healed-queue.json');
    const result = detectArtifactDrift(99, issue, {
      planExists: true,
      plannerReady: false,
      routeStale: false,
      prOpen: false,
      checkpointWorkers: [],
      notes: issue.notes,
    });
    expect(result.drift).toBeNull();
    expect(result.heal).toBeNull();
  });

  test('pr-healed state produces no drift', () => {
    const issue = readIssueFixture('pr-healed-queue.json');
    const result = detectArtifactDrift(99, issue, {
      planExists: true,
      plannerReady: false,
      routeStale: false,
      prOpen: true,
      checkpointWorkers: [],
      notes: issue.notes,
    });
    expect(result.drift).toBeNull();
    expect(result.heal).toBeNull();
  });
});
