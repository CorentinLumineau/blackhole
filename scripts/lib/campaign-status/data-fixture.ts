import { buildStatusReport } from './report.ts';
import type { QueueJson, StatusReport } from './types.ts';

/** A populated report: every dataset of the status data has at least one row. */
export const FIXTURE_QUEUE: QueueJson = {
  refreshed_at: '2026-11-11T11:00:00.000Z',
  issues: {
    '1': { title: 'gate', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' },
    '2': { title: 'motion', status: 'in-flight', phase: 'implement' },
    '3': { title: 'review me', status: 'in-flight', phase: 'review', pr: 9 },
    '4': { title: 'delivered', status: 'in-flight', phase: 'review', pr: 10, notes: 'delivered-at-LGTM (leave-open) — awaiting human merge' },
    '5': { title: 'dep a', status: 'blocked', phase: 'handle', depends_on: [2] },
    '6': { title: 'dep b', status: 'blocked', phase: 'handle', depends_on: [2] },
    '7': { title: 'dep c', status: 'blocked', phase: 'handle', depends_on: [2] },
    '8': { title: 'dep d', status: 'blocked', phase: 'handle', depends_on: [2] },
    '9': { title: 'next', status: 'ready', phase: 'handle' },
    '10': { title: 'old', status: 'merged', phase: 'done', pr: 5 },
  },
};

export function fixtureReport(queue: QueueJson = FIXTURE_QUEUE): StatusReport {
  return buildStatusReport({
    config: { repo: 'acme/widgets', scope_milestone: 'v1.0' },
    queue,
    ledger: { findings: [{ id: 'F-1', vcode: 'V-SEC-04', severity: 'BLOCK', status: 'open', summary: 'leak', issue_ref: 3 }] },
    checkpoint: { orchestrator_turn_id: 7, refreshed_at: '2026-11-11T10:00:00.000Z' },
    checkpointBody: '---\norchestrator_turn_id: 7\n---\n\n## Notes\n\nMerged #2\n\n## In-flight workers\n\n- worker for #2\n',
    forge: { openIssues: 3, openPrs: 1, ok: true },
    paceLine: 'pace: GO (session 12%)',
    hostNotes: ['⚠ Plugin cache drift: layer 2'],
    generatedAt: '2026-11-11T12:00:00.000Z',
  });
}

