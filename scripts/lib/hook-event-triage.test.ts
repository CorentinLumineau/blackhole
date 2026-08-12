import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from './test-fixtures.ts';
import { ingestHookEvents } from './hook-event-triage.ts';

describe('ingestHookEvents — Triage 1b round-trip', () => {
  test('tier error ingests as V-HOOK-03, resolves issue_ref, deletes hook-event file', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const worktree = path.join(repoRoot, '.worktrees', 'wt-598');
      fs.mkdirSync(worktree, { recursive: true });

      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      const eventFile = path.join(eventsDir, 'error-event.json');
      fs.writeFileSync(
        eventFile,
        JSON.stringify({
          version: 1,
          recorded_at: '2026-08-12T12:00:00.000Z',
          hook: 'validate-bash-command',
          tool: 'Bash',
          decision: 'allow',
          tier: 'error',
          pattern_id: 'hook-exec-failure',
          reason: 'validator process exited 1 before producing a decision',
          worktree,
          detail: 'process exit code 1',
        }),
        'utf-8',
      );

      const ledger = {
        refreshed_at: '2026-08-12T00:00:00.000Z',
        next_id: 1,
        findings: [] as [],
      };

      const { ingested, ledger: updated } = ingestHookEvents({
        repoRoot,
        queueIssues: {
          '598': { status: 'in-flight', worktree },
        },
        ledger,
      });

      expect(ingested).toBe(1);
      expect(fs.existsSync(eventFile)).toBe(false);
      expect(updated.findings).toHaveLength(1);
      expect(updated.findings[0]).toMatchObject({
        vcode: 'V-HOOK-03',
        severity: 'BLOCK',
        phase: 'implement',
        issue_ref: 598,
        file: '.blackhole/hook-events/error-event.json',
        line: 0,
      });
    });
  });

  test('unmatched worktree still appends with issue_ref null', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(
        path.join(eventsDir, 'orphan.json'),
        JSON.stringify({
          version: 1,
          tier: 'error',
          pattern_id: 'hook-exec-failure',
          reason: 'validator process exited 127 before producing a decision',
          worktree: '/tmp/no-queue-match',
        }),
        'utf-8',
      );

      const { ledger: updated } = ingestHookEvents({
        repoRoot,
        queueIssues: {},
        ledger: { refreshed_at: '', next_id: 1, findings: [] },
      });

      expect(updated.findings[0]?.issue_ref).toBeNull();
      expect(updated.findings[0]?.vcode).toBe('V-HOOK-03');
    });
  });

  test('dedup skips append when open row shares (vcode, file, line, issue_ref)', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(
        path.join(eventsDir, 'dup.json'),
        JSON.stringify({ tier: 'block', reason: 'denied rm -rf', worktree: null }),
        'utf-8',
      );

      const ledger = {
        refreshed_at: '',
        next_id: 2,
        findings: [
          {
            id: 'F-00001',
            vcode: 'V-HOOK-01',
            severity: 'BLOCK' as const,
            phase: 'implement',
            issue_ref: null,
            pr_ref: null,
            file: '.blackhole/hook-events/dup.json',
            line: 0,
            summary: 'prior',
            status: 'open',
            deferred_to_issue: null,
            created_at: '',
            resolved_at: null,
          },
        ],
      };

      const { ingested, ledger: updated } = ingestHookEvents({
        repoRoot,
        queueIssues: {},
        ledger,
      });

      expect(ingested).toBe(1);
      expect(updated.findings).toHaveLength(1);
      expect(updated.next_id).toBe(2);
    });
  });
});
