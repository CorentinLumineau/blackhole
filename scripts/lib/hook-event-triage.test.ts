import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from './test-fixtures.ts';
import { ingestHookEvents, main } from './hook-event-triage.ts';
import { root } from '../checks/check-utils.ts';

// ADR-042 — finding identity is per-class `(vcode, pattern_id, worktree)`, not
// per-event-filename. Every fixture below constructs its expected `file` the same way the
// implementation does (`.blackhole/hook-events/<len>:<pattern_id>/<worktree-key>`, netstring
// length-prefixed so a `pattern_id` containing `/` can never collide with the separator), never
// a literal event filename.
const classId = (patternId: string, worktreeKey: string): string =>
  `.blackhole/hook-events/${patternId.length}:${patternId}/${worktreeKey}`;

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
        file: classId('hook-exec-failure', resolvedWorktree),
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
            file: classId('denied-rm-rf', 'no-worktree'),
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
            file: classId('system-path', 'no-worktree'),
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

  // Fix round 1 (PR #908, item 2) — a raw `/` join let two distinct (pattern_id, worktree)
  // pairs collapse onto the identical class-identity string: pattern_id "foo/" + worktree
  // `null` and pattern_id "foo" + worktree "/no-worktree" both produced
  // ".blackhole/hook-events/foo//no-worktree". The netstring length prefix on `pattern_id`
  // disambiguates them, so the two events below must land as two separate rows, not one
  // dedup-collapsed row with occurrences: 2.
  test('a pattern_id containing "/" cannot collide with a distinct pattern_id/worktree pair', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(
        path.join(eventsDir, 'slash-pattern.json'),
        JSON.stringify({ tier: 'block', pattern_id: 'foo/', reason: 'first', worktree: null }),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(eventsDir, 'sentinel-worktree.json'),
        JSON.stringify({ tier: 'block', pattern_id: 'foo', reason: 'second', worktree: '/no-worktree' }),
        'utf-8',
      );

      const { ingested, ledger: updated } = ingestHookEvents({
        repoRoot,
        queueIssues: {},
        ledger: { refreshed_at: '', next_id: 1, findings: [] },
      });

      expect(ingested).toBe(2);
      expect(updated.findings).toHaveLength(2);
      const files = updated.findings.map((f) => f.file);
      expect(new Set(files).size).toBe(2);
      expect(files).toContain(classId('foo/', 'no-worktree'));
      expect(files).toContain(classId('foo', '/no-worktree'));
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

  test('a malformed event file is skipped (JSON parse failure) without aborting the batch', () => {
    withTempDir('hook-triage-', (repoRoot) => {
      const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(path.join(eventsDir, 'broken.json'), '{ not valid json', 'utf-8');
      fs.writeFileSync(
        path.join(eventsDir, 'ok.json'),
        JSON.stringify({ tier: 'warn', pattern_id: 'force-push', reason: 'force push detected', worktree: null }),
        'utf-8',
      );

      const { ingested, ledger: updated } = ingestHookEvents({
        repoRoot,
        queueIssues: {},
        ledger: { refreshed_at: '', next_id: 1, findings: [] },
      });

      expect(ingested).toBe(1);
      expect(updated.findings).toHaveLength(1);
      // the malformed file is left in place — never archived, never deleted
      expect(fs.existsSync(path.join(eventsDir, 'broken.json'))).toBe(true);
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

// Task 8 — the `main()` CLI entrypoint the turn-start step invokes. Runs against THIS repo's
// own worktree root (main() resolves `root` the same way plugin-drift-signal.ts/
// doc-health-signal.ts do — relative to the running script's own location, never `process.cwd`),
// so every test creates its own `.blackhole/` here and removes it in `finally` — guarded by an
// upfront assertion that no `.blackhole/` already exists, so a test never clobbers real state.
describe('main() CLI entrypoint', () => {
  const campaignDir = path.join(root, '.blackhole');

  const withCampaignDir = (fn: () => void): void => {
    expect(fs.existsSync(campaignDir)).toBe(false);
    try {
      fn();
    } finally {
      fs.rmSync(campaignDir, { recursive: true, force: true });
    }
  };

  test('no findings-ledger.json: logs and exits 0 without creating .blackhole/', () => {
    withCampaignDir(() => {
      const proc = Bun.spawnSync({
        cmd: ['bun', 'run', 'scripts/lib/hook-event-triage.ts'],
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.toString()).toContain('nothing to ingest into');
      expect(fs.existsSync(campaignDir)).toBe(false);
    });
  });

  test('ledger + hook events present: ingests, archives the event, writes the ledger through the guard', () => {
    withCampaignDir(() => {
      fs.mkdirSync(campaignDir, { recursive: true });
      const ledgerPath = path.join(campaignDir, 'findings-ledger.json');
      fs.writeFileSync(
        ledgerPath,
        JSON.stringify({ refreshed_at: '', next_id: 1, findings: [] }, null, 2),
      );
      const eventsDir = path.join(campaignDir, 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(
        path.join(eventsDir, 'cli-test-event.json'),
        JSON.stringify({ tier: 'warn', pattern_id: 'force-push', reason: 'force push detected', worktree: null }),
        'utf-8',
      );

      const proc = Bun.spawnSync({
        cmd: ['bun', 'run', 'scripts/lib/hook-event-triage.ts'],
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.toString()).toContain('ingested 1 event');
      expect(fs.existsSync(path.join(eventsDir, 'cli-test-event.json'))).toBe(false);

      const updated = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
      expect(updated.findings).toHaveLength(1);
      expect(updated.findings[0].vcode).toBe('V-HOOK-02');
      expect(updated.findings[0].occurrences).toBe(1);

      const archiveRoot = path.join(campaignDir, 'archive');
      const archiveDirs = fs.readdirSync(archiveRoot).filter((d) => d.startsWith('hook-events-'));
      expect(archiveDirs.length).toBeGreaterThan(0);
      // one snapshot of the pre-ingest ledger, plus the archived event directory
      const ledgerSnapshots = fs.readdirSync(archiveRoot).filter((d) => d.startsWith('findings-ledger-'));
      expect(ledgerSnapshots.length).toBeGreaterThan(0);
    });
  });

  // Fix round 1 (PR #908, item 1) — the write-guard-refusal branch was previously unexercised:
  // no test confirmed `main()` aborts before `fs.renameSync` when `validateStateWrite` returns
  // `ok: false`. The real write-protocol flow only ever grows the findings count, so a genuine
  // rejection can't be manufactured through real inputs; called in-process (not via
  // `Bun.spawnSync` like the two tests above) so a stub can be injected for `deps.validateStateWrite`.
  test('write guard refuses: does not install the tmp file, removes it, and exits non-zero', () => {
    withCampaignDir(() => {
      fs.mkdirSync(campaignDir, { recursive: true });
      const ledgerPath = path.join(campaignDir, 'findings-ledger.json');
      const originalLedgerContent = JSON.stringify({ refreshed_at: '', next_id: 1, findings: [] }, null, 2);
      fs.writeFileSync(ledgerPath, originalLedgerContent);
      const eventsDir = path.join(campaignDir, 'hook-events');
      fs.mkdirSync(eventsDir, { recursive: true });
      fs.writeFileSync(
        path.join(eventsDir, 'guard-refusal-event.json'),
        JSON.stringify({ tier: 'warn', pattern_id: 'force-push', reason: 'force push detected', worktree: null }),
        'utf-8',
      );

      // `process.exitCode` is a process-global — save/restore it so a forced non-zero code
      // here never leaks into this test file's own exit status.
      const originalExitCode = process.exitCode;
      try {
        main({ validateStateWrite: () => ({ ok: false, reason: 'test-forced-refusal' }) });
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = originalExitCode;
      }

      // The refusal must abort before the atomic rename — the live ledger is untouched and the
      // rejected .tmp file is cleaned up, not left behind.
      expect(fs.readFileSync(ledgerPath, 'utf-8')).toBe(originalLedgerContent);
      expect(fs.existsSync(`${ledgerPath}.tmp`)).toBe(false);
    });
  });
});
