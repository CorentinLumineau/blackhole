import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import {
  classifyDeferredFinding,
  resolveClosureInfo,
  triageFindings,
  type FetchedIssue,
  type LedgerFinding,
  type QueueIssues,
} from './triage-deferred-findings.ts';

// Issue #809 — one-time triage of the existing `deferred` backlog whose `deferred_to_issue`
// target has closed with no `reconciled_at` recorded. Pure-function tests only: this script is
// deliberately never run against the live ledger by the implementer (single-writer invariant,
// `blackhole-state.md`) — the orchestrator runs it post-merge as a separate step. Fixture-only
// coverage here proves the classification/write-shape logic without touching live campaign state.

const finding = (overrides: Partial<LedgerFinding>): LedgerFinding => ({
  id: 'F-00001',
  vcode: 'V-CONTENTGATE-01',
  file: 'scripts/checks/plan-quality-gate.check.ts',
  status: 'deferred',
  deferred_to_issue: 545,
  ...overrides,
});

describe('resolveClosureInfo (pure)', () => {
  test('target present in queueIssues with status merged resolves tracked+closed, carrying its title', () => {
    const queueIssues: QueueIssues = { '545': { status: 'merged', title: 'Fix ceiling exhaustion' } };
    expect(resolveClosureInfo(545, queueIssues, () => null)).toEqual({
      kind: 'tracked',
      closed: true,
      title: 'Fix ceiling exhaustion',
    });
  });

  test('target present in queueIssues with status ready resolves tracked+open — no gh call made', () => {
    let called = false;
    const queueIssues: QueueIssues = { '305': { status: 'ready' } };
    const result = resolveClosureInfo(305, queueIssues, () => {
      called = true;
      return null;
    });
    expect(result).toEqual({ kind: 'tracked', closed: false, title: undefined });
    expect(called).toBe(false);
  });

  test('target absent from queueIssues falls back to the fetch function — untracked+closed', () => {
    const fetched: FetchedIssue = { state: 'CLOSED', title: 'Some title', body: 'Some body' };
    const result = resolveClosureInfo(624, {}, () => fetched);
    expect(result).toEqual({ kind: 'untracked', closed: true, title: 'Some title', body: 'Some body' });
  });

  test('target absent from queueIssues and fetch fails resolves unreachable', () => {
    expect(resolveClosureInfo(624, {}, () => null)).toEqual({ kind: 'unreachable' });
  });
});

describe('classifyDeferredFinding (pure)', () => {
  test('unreachable closure yields outcome unreachable', () => {
    expect(classifyDeferredFinding(finding({}), { kind: 'unreachable' })).toEqual({ outcome: 'unreachable' });
  });

  test('target still open yields outcome still-open, regardless of tracked/untracked', () => {
    expect(classifyDeferredFinding(finding({}), { kind: 'tracked', closed: false })).toEqual({ outcome: 'still-open' });
  });

  test('closed target whose title mentions the finding vcode resolves via title match', () => {
    const closure = { kind: 'tracked' as const, closed: true, title: 'Fix V-CONTENTGATE-01 ceiling exhaustion' };
    expect(classifyDeferredFinding(finding({}), closure)).toEqual({ outcome: 'resolved', rule: 'closed-pr-title-match' });
  });

  test('closed target whose title mentions the finding file basename resolves via title match', () => {
    const closure = { kind: 'tracked' as const, closed: true, title: 'Fix plan-quality-gate.check.ts overflow' };
    expect(classifyDeferredFinding(finding({}), closure)).toEqual({ outcome: 'resolved', rule: 'closed-pr-title-match' });
  });

  test('untracked closed target with no title match but a body match resolves via body match', () => {
    const closure = { kind: 'untracked' as const, closed: true, title: 'Unrelated title', body: 'Addresses V-CONTENTGATE-01' };
    expect(classifyDeferredFinding(finding({}), closure)).toEqual({ outcome: 'resolved', rule: 'closed-pr-body-match' });
  });

  test('closed target with no title/body reference to vcode or file reopens as manual-triage', () => {
    const closure = { kind: 'tracked' as const, closed: true, title: 'Totally unrelated fix' };
    expect(classifyDeferredFinding(finding({}), closure)).toEqual({ outcome: 'reopen', rule: 'manual-triage' });
  });

  // Direct AC3-shaped requirement, mirrored here for the triage script: proves the classifier is
  // not vacuously "always reopen" or "always resolved" — a stub returning a fixed outcome would
  // fail one of the two assertions above and this one together.
  test('is not vacuously true — matching and non-matching titles produce different outcomes', () => {
    const matching = classifyDeferredFinding(finding({}), { kind: 'tracked', closed: true, title: 'V-CONTENTGATE-01 fix' });
    const nonMatching = classifyDeferredFinding(finding({}), { kind: 'tracked', closed: true, title: 'unrelated' });
    expect(matching.outcome).not.toBe(nonMatching.outcome);
  });
});

describe('triageFindings (pure orchestration over an in-memory fixture set)', () => {
  test('classifies a mixed batch: resolved, reopened, still-open (untouched), already-reconciled (untouched)', () => {
    const findings: LedgerFinding[] = [
      finding({ id: 'F-00001', deferred_to_issue: 545 }), // closed target, title matches -> resolved
      finding({ id: 'F-00002', deferred_to_issue: 305, vcode: 'V-DRY-01', file: 'a.ts' }), // closed, no match -> reopen
      finding({ id: 'F-00003', deferred_to_issue: 999 }), // still open -> untouched
      finding({ id: 'F-00004', deferred_to_issue: 545, reconciled_at: '2026-08-01T00:00:00.000Z' }), // already reconciled -> untouched
      { id: 'F-00005', vcode: 'V-DOC-01', status: 'open', deferred_to_issue: null } as LedgerFinding, // not deferred -> untouched
    ];
    const queueIssues: QueueIssues = {
      '545': { status: 'merged', title: 'Fix V-CONTENTGATE-01 ceiling exhaustion' },
      '305': { status: 'closed', title: 'Unrelated cleanup' },
      '999': { status: 'ready' },
    };

    const { findings: out, summary } = triageFindings(findings, queueIssues, () => null);

    expect(summary).toEqual({ examined: 3, resolved: 1, reopened: 1, untrackedOrUnreachable: 0, aborted: false });

    const byId = Object.fromEntries(out.map((f) => [f.id, f]));
    expect(byId['F-00001'].status).toBe('resolved');
    expect(byId['F-00001'].reconciliation_rule).toBe('closed-pr-title-match');
    expect(byId['F-00001'].reconciled_at).toBeDefined();

    expect(byId['F-00002'].status).toBe('open');
    expect(byId['F-00002'].reconciliation_rule).toBe('manual-triage');
    expect(byId['F-00002'].reconciled_at).toBeDefined();

    expect(byId['F-00003'].status).toBe('deferred');
    expect(byId['F-00003'].reconciled_at).toBeUndefined();

    expect(byId['F-00004'].status).toBe('deferred');
    expect(byId['F-00004'].reconciliation_rule).toBeUndefined();

    expect(byId['F-00005'].status).toBe('open');
  });

  test('a target untracked (absent from queue.json) and resolved via gh counts in untrackedOrUnreachable', () => {
    const findings: LedgerFinding[] = [finding({ id: 'F-00006', deferred_to_issue: 624 })];
    const fetch = (n: number): FetchedIssue | null => (n === 624 ? { state: 'CLOSED', title: 'unrelated title', body: 'no mention' } : null);

    const { findings: out, summary } = triageFindings(findings, {}, fetch);
    expect(summary).toEqual({ examined: 1, resolved: 0, reopened: 1, untrackedOrUnreachable: 1, aborted: false });
    expect(out[0].status).toBe('open');
    expect(out[0].reconciliation_rule).toBe('manual-triage');
  });

  test('an unreachable target (gh fetch fails) aborts the run — remaining findings pass through untouched', () => {
    const findings: LedgerFinding[] = [
      finding({ id: 'F-00007', deferred_to_issue: 624 }),
      finding({ id: 'F-00008', deferred_to_issue: 545 }),
    ];
    const queueIssues: QueueIssues = { '545': { status: 'merged', title: 'V-CONTENTGATE-01 fix' } };

    const { findings: out, summary } = triageFindings(findings, queueIssues, () => null);

    expect(summary.aborted).toBe(true);
    expect(summary.abortedAt).toBe(624);
    // Never trust an unreachable target as resolved — F-00008 (which WOULD have resolved) must
    // remain untouched because the run stopped before reaching it.
    const byId = Object.fromEntries(out.map((f) => [f.id, f]));
    expect(byId['F-00007'].status).toBe('deferred');
    expect(byId['F-00008'].status).toBe('deferred');
    expect(byId['F-00008'].reconciled_at).toBeUndefined();
  });
});

describe('triage-deferred-findings CLI (subprocess, temp-dir fixtures)', () => {
  const scriptPath = path.join(import.meta.dirname, 'triage-deferred-findings.ts');
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir('triage-cli-');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (args: string[]) => Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });

  test('--dry-run against a violating fixture prints the summary and writes nothing back', async () => {
    const ledgerPath = path.join(dir, 'findings-ledger.json');
    const queuePath = path.join(dir, 'queue.json');
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({
        refreshed_at: '2026-08-01T00:00:00.000Z',
        next_id: 2,
        findings: [finding({ id: 'F-00001', deferred_to_issue: 545 })],
      }),
    );
    fs.writeFileSync(queuePath, JSON.stringify({ issues: { '545': { status: 'merged', title: 'V-CONTENTGATE-01 fix' } } }));
    const before = fs.readFileSync(ledgerPath, 'utf-8');

    const proc = run(['--dry-run', '--ledger', ledgerPath, '--queue', queuePath]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);

    expect(code).toBe(0);
    expect(stdout).toContain('Resolved: 1');
    expect(stdout).toContain('Dry run');
    expect(fs.readFileSync(ledgerPath, 'utf-8')).toBe(before);
  });

  test('a real (non-dry-run) run writes the reconciled ledger back through the write-guard', async () => {
    const ledgerPath = path.join(dir, 'findings-ledger.json');
    const queuePath = path.join(dir, 'queue.json');
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({
        refreshed_at: '2026-08-01T00:00:00.000Z',
        next_id: 2,
        findings: [finding({ id: 'F-00001', deferred_to_issue: 545 })],
      }),
    );
    fs.writeFileSync(queuePath, JSON.stringify({ issues: { '545': { status: 'merged', title: 'V-CONTENTGATE-01 fix' } } }));

    const proc = run(['--ledger', ledgerPath, '--queue', queuePath]);
    const code = await proc.exited;

    expect(code).toBe(0);
    const updated = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    expect(updated.findings[0].status).toBe('resolved');
    expect(updated.findings[0].reconciled_at).toBeDefined();
    expect(fs.existsSync(`${ledgerPath}.tmp`)).toBe(false);
  });

  test('missing ledger file exits 1 with a clear message on stderr', async () => {
    const proc = run(['--ledger', path.join(dir, 'missing.json'), '--queue', path.join(dir, 'queue.json')]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain('not found');
  });
});
