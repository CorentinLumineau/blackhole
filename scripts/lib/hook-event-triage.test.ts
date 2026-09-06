import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from './test-fixtures.ts';
import { ingestHookEvents } from './hook-event-triage.ts';

// ADR-042 (issue #893) — finding identity is per-class `(vcode, pattern_id, worktree)`, not
// per-event-filename. Every fixture below constructs its expected `file` the same way the
// implementation does (`.blackhole/hook-events/<pattern_id>/<worktree-key>`), never a literal
// event filename.

describe('ingestHookEvents — Triage 1b round-trip', () => {
  test('tier error ingests as V-HOOK-03, resolves issue_ref, archives (not deletes) the hook-event file', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const worktree = path.join(repoRoot, '.worktrees', 'wt-598');
      fs.mkdirSync(worktree, { recursive: true });
      const resolvedWorktree = fs.realpathSync(worktree);

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
        file: `.blackhole/hook-events/hook-exec-failure/${resolvedWorktree}`,
        line: 0,
        occurrences: 1,
      });
      expect(updated.findings[0].last_seen_at).toBeTruthy();
      expect(updated.findings[0].summary).toContain('process exit code 1');

      // Archived, not unlinked (ADR-042 item 4).
      const archiveRoot = path.join(repoRoot, '.blackhole', 'archive');
      const archiveDirs = fs.readdirSync(archiveRoot).filter((d) => d.startsWith('hook-events-'));
      expect(archiveDirs.length).toBe(1);
      expect(fs.readdirSync(path.join(archiveRoot, archiveDirs[0]))).toContain('error-event.json');
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

  test('dedup collapses onto an existing open row sharing (vcode, pattern_id, worktree) identity', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(
        path.join(eventsDir, 'dup.json'),
        JSON.stringify({ tier: 'block', pattern_id: 'denied-rm-rf', reason: 'denied rm -rf', worktree: null }),
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
            file: '.blackhole/hook-events/denied-rm-rf/no-worktree',
            line: 0,
            summary: 'prior',
            status: 'open',
            deferred_to_issue: null,
            created_at: '',
            resolved_at: null,
            // no `occurrences` field — simulates a pre-migration row; the implementation must
            // treat its absence as an implicit 1.
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
      expect(updated.findings[0].occurrences).toBe(2);
      expect(updated.findings[0].last_seen_at).toBeTruthy();
    });
  });

  // Task 2(a) — red on `main` (plan_base_commit d55cd59a) because today's `file` is the
  // per-event generated filename: two events with the same (vcode, pattern_id, worktree)
  // always produce two distinct rows, never a collision.
  test('2a — two events sharing (vcode, pattern_id, worktree) collapse into one row with occurrences: 2', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      const event = {
        tier: 'error',
        pattern_id: 'hook-exec-failure',
        reason: 'validator process exited 1 before producing a decision',
        worktree: null,
      };
      fs.writeFileSync(path.join(eventsDir, 'a.json'), JSON.stringify(event), 'utf-8');
      fs.writeFileSync(path.join(eventsDir, 'b.json'), JSON.stringify(event), 'utf-8');

      const { ingested, ledger: updated } = ingestHookEvents({
        repoRoot,
        queueIssues: {},
        ledger: { refreshed_at: '', next_id: 1, findings: [] },
      });

      expect(ingested).toBe(2);
      expect(updated.findings).toHaveLength(1);
      expect(updated.findings[0].occurrences).toBe(2);
    });
  });

  // Task 2(b) — red on `main` because `isDedupCandidate` admits `deferred`: today's code would
  // silently bump the deferred row's (nonexistent) counter and produce zero new rows.
  test('2b — a repeat against a deferred row produces a new open row, not a silent bump', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(
        path.join(eventsDir, 'c.json'),
        JSON.stringify({ tier: 'block', pattern_id: 'system-path', reason: 'denied /etc/passwd', worktree: null }),
        'utf-8',
      );

      const ledger = {
        refreshed_at: '',
        next_id: 5,
        findings: [
          {
            id: 'F-00004',
            vcode: 'V-HOOK-01',
            severity: 'BLOCK' as const,
            phase: 'implement',
            issue_ref: null,
            pr_ref: null,
            file: '.blackhole/hook-events/system-path/no-worktree',
            line: 0,
            summary: 'prior',
            status: 'deferred',
            deferred_to_issue: 900,
            created_at: '',
            resolved_at: null,
            occurrences: 3,
          },
        ],
      };

      const { ingested, ledger: updated } = ingestHookEvents({ repoRoot, queueIssues: {}, ledger });

      expect(ingested).toBe(1);
      expect(updated.findings).toHaveLength(2);
      const newRow = updated.findings.find((f) => f.id !== 'F-00004');
      expect(newRow?.status).toBe('open');
      expect(newRow?.occurrences).toBe(1);
      const deferredRow = updated.findings.find((f) => f.id === 'F-00004');
      expect(deferredRow?.status).toBe('deferred');
      expect(deferredRow?.occurrences).toBe(3);
    });
  });

  // Task 2(c) — red on `main` because `fs.unlinkSync` leaves no archive directory at all.
  test('2c — a consumed event is archived under .blackhole/archive/hook-events-<ts>/, not unlinked', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(
        path.join(eventsDir, 'd.json'),
        JSON.stringify({ tier: 'warn', pattern_id: 'force-push', reason: 'force push detected', worktree: null }),
        'utf-8',
      );

      ingestHookEvents({ repoRoot, queueIssues: {}, ledger: { refreshed_at: '', next_id: 1, findings: [] } });

      expect(fs.existsSync(path.join(eventsDir, 'd.json'))).toBe(false);
      const archiveRoot = path.join(repoRoot, '.blackhole', 'archive');
      const archiveDirs = fs.readdirSync(archiveRoot).filter((d) => d.startsWith('hook-events-'));
      expect(archiveDirs.length).toBeGreaterThan(0);
      const archivedFiles = fs.readdirSync(path.join(archiveRoot, archiveDirs[0]));
      expect(archivedFiles).toContain('d.json');
    });
  });

  // Task 3 AC / Sprint Contract — the mechanical never-drop proof: replaying the measured live
  // backlog tally (227 error / 115 block / 50 warn = 392) must collapse to ≤15 rows while the
  // summed `occurrences` across those rows equals the input event count exactly.
  test('Task 3 AC — 392-event replay (227 error / 115 block / 50 warn) collapses to ≤15 rows summing to exactly 392 occurrences', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });

      type Cls = { tier: 'error' | 'block' | 'warn'; pattern_id: string; worktree: string | null };
      const classes: Cls[] = [];
      for (let i = 0; i < 4; i++) {
        classes.push({ tier: 'error', pattern_id: 'hook-exec-failure', worktree: i === 0 ? null : `/tmp/wt-err-${i}` });
      }
      for (let i = 0; i < 5; i++) {
        classes.push({ tier: 'block', pattern_id: `block-pattern-${i}`, worktree: i === 0 ? null : `/tmp/wt-block-${i}` });
      }
      for (let i = 0; i < 3; i++) {
        classes.push({ tier: 'warn', pattern_id: `warn-pattern-${i}`, worktree: i === 0 ? null : `/tmp/wt-warn-${i}` });
      }
      // 4 + 5 + 3 = 12 distinct classes, well under the ≤15 AC.

      const counts: Record<Cls['tier'], number> = { error: 227, block: 115, warn: 50 };
      const perTier: Record<Cls['tier'], Cls[]> = { error: [], block: [], warn: [] };
      for (const c of classes) perTier[c.tier].push(c);

      let fileIndex = 0;
      for (const tier of ['error', 'block', 'warn'] as const) {
        const tierClasses = perTier[tier];
        for (let i = 0; i < counts[tier]; i++) {
          const cls = tierClasses[i % tierClasses.length];
          fs.writeFileSync(
            path.join(eventsDir, `${tier}-${fileIndex++}.json`),
            JSON.stringify({
              tier: cls.tier,
              pattern_id: cls.pattern_id,
              reason: `${cls.tier} event`,
              worktree: cls.worktree,
            }),
            'utf-8',
          );
        }
      }

      const { ingested, ledger: updated } = ingestHookEvents({
        repoRoot,
        queueIssues: {},
        ledger: { refreshed_at: '', next_id: 1, findings: [] },
      });

      expect(ingested).toBe(392);
      expect(updated.findings.length).toBeLessThanOrEqual(15);
      const totalOccurrences = updated.findings.reduce((sum, f) => sum + (f.occurrences ?? 0), 0);
      expect(totalOccurrences).toBe(392);
    });
  });
});
