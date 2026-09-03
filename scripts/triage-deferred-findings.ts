import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { validateStateWrite } from './lib/state-write-guard.ts';
import { runGhJson } from './lib/forge-adapter/cli.ts';

// Issue #809 — one-time migration/triage of `findings-ledger.json`'s existing `deferred`
// backlog: reconciles every `deferred` row whose `deferred_to_issue` target has closed with no
// `reconciled_at` recorded yet, via the reproducible rule below. This is a ONE-TIME script, not
// a per-turn check (that's `scripts/checks/deferred-reconciliation.check.ts`, V-DEFER-01) — it
// mutates the live ledger and so is run by the orchestrator alone (single-writer invariant,
// `blackhole-state.md` § Single-writer invariant), never by an implementer worker.

export type LedgerFinding = {
  id: string;
  vcode: string;
  file?: string;
  status: string;
  deferred_to_issue: number | null;
  reconciled_at?: string | null;
  reconciliation_rule?: string | null;
  [key: string]: unknown;
};

export type QueueIssues = Record<string, { status?: string; title?: string }>;

export type FetchedIssue = { state: 'OPEN' | 'CLOSED'; title?: string; body?: string };

export type ClosureInfo =
  | { kind: 'tracked'; closed: boolean; title?: string }
  | { kind: 'untracked'; closed: boolean; title?: string; body?: string }
  | { kind: 'unreachable' };

// `.blackhole/queue.json` is already forge-synced every turn (`forge-sync.md` § Native
// auto-sync) — resolving closure state from it first, and calling `fetchUntracked` (the sole,
// scoped `gh issue view` exception, Codebase Conventions row 2) only when the target key is
// entirely absent from `queueIssues` (e.g. #624 — never ingested into queue.json).
export const resolveClosureInfo = (
  target: number,
  queueIssues: QueueIssues,
  fetchUntracked: (n: number) => FetchedIssue | null,
): ClosureInfo => {
  const entry = queueIssues[String(target)];
  if (entry !== undefined) {
    return { kind: 'tracked', closed: entry.status === 'merged' || entry.status === 'closed', title: entry.title };
  }
  const fetched = fetchUntracked(target);
  if (fetched === null) return { kind: 'unreachable' };
  return { kind: 'untracked', closed: fetched.state === 'CLOSED', title: fetched.title, body: fetched.body };
};

export type ClassificationOutcome =
  | { outcome: 'still-open' }
  | { outcome: 'unreachable' }
  | { outcome: 'resolved'; rule: 'closed-pr-title-match' | 'closed-pr-body-match' }
  | { outcome: 'reopen'; rule: 'manual-triage' };

const mentionsFinding = (text: string | undefined, f: LedgerFinding): boolean => {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (f.vcode && lower.includes(f.vcode.toLowerCase())) return true;
  if (f.file) {
    const base = f.file.split('/').pop() ?? f.file;
    if (base && lower.includes(base.toLowerCase())) return true;
  }
  return false;
};

// The reproducible classification rule (AC4): a closed target whose title (or, for an untracked
// target, body — the only case a body is available at all) explicitly references the finding's
// `vcode` or `file` basename is classified as the work having shipped (`resolved`). Every other
// closed target reopens to `open` (dropping the stale `deferred_to_issue` — it no longer covers
// the finding) flagged `manual-triage` for human confirmation, per this plan's Stop Condition on
// false-shipped risk: an unmatched title/body is not proof the work didn't ship, only that this
// heuristic can't confirm it did, so it defers to a human rather than guessing "resolved".
export const classifyDeferredFinding = (f: LedgerFinding, closure: ClosureInfo): ClassificationOutcome => {
  if (closure.kind === 'unreachable') return { outcome: 'unreachable' };
  if (!closure.closed) return { outcome: 'still-open' };
  if (mentionsFinding(closure.title, f)) return { outcome: 'resolved', rule: 'closed-pr-title-match' };
  if (closure.kind === 'untracked' && mentionsFinding(closure.body, f)) {
    return { outcome: 'resolved', rule: 'closed-pr-body-match' };
  }
  return { outcome: 'reopen', rule: 'manual-triage' };
};

export type TriageSummary = {
  examined: number;
  resolved: number;
  reopened: number;
  untrackedOrUnreachable: number;
  aborted: boolean;
  abortedAt?: number;
};

export type TriageResult = { findings: LedgerFinding[]; summary: TriageSummary };

// Pure orchestration core: no fs/gh access — `fetchUntracked` is injected so this stays
// in-memory-testable (Codebase Conventions row 4, mirrors `findAdrWatchViolations`'s split).
// On an unreachable target, the Stop Condition ("never silently treat an unreachable target as
// open, and never let it produce a false resolved") applies at the run level, not the row level:
// the whole run aborts immediately, leaving every remaining row — including this one — untouched,
// rather than risking a wrong classification on an unverifiable target.
export const triageFindings = (
  findings: LedgerFinding[],
  queueIssues: QueueIssues,
  fetchUntracked: (n: number) => FetchedIssue | null,
): TriageResult => {
  const out: LedgerFinding[] = [];
  const summary: TriageSummary = { examined: 0, resolved: 0, reopened: 0, untrackedOrUnreachable: 0, aborted: false };

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (f.status !== 'deferred' || f.reconciled_at || f.deferred_to_issue == null) {
      out.push(f);
      continue;
    }

    summary.examined++;
    const closure = resolveClosureInfo(f.deferred_to_issue, queueIssues, fetchUntracked);
    const classification = classifyDeferredFinding(f, closure);

    if (classification.outcome === 'unreachable') {
      summary.aborted = true;
      summary.abortedAt = f.deferred_to_issue;
      out.push(f, ...findings.slice(i + 1));
      return { findings: out, summary };
    }

    if (classification.outcome === 'still-open') {
      out.push(f);
      continue;
    }

    if (closure.kind === 'untracked') summary.untrackedOrUnreachable++;

    const reconciled_at = new Date().toISOString();
    if (classification.outcome === 'resolved') {
      summary.resolved++;
      out.push({ ...f, status: 'resolved', reconciled_at, reconciliation_rule: classification.rule });
    } else {
      summary.reopened++;
      out.push({ ...f, status: 'open', reconciled_at, reconciliation_rule: classification.rule });
    }
  }

  return { findings: out, summary };
};

// The one, scoped `gh` call this script makes — only for a target absent from `queueIssues`
// entirely. Routed through `runGhJson` (the sole allowed `gh` spawn site, `forge-adapter/cli.ts`
// — V-FORGE-01) rather than spawning the CLI directly in this file. Any failure (auth, rate
// limit, issue truly gone) returns `null`, which `resolveClosureInfo` turns into
// `{ kind: 'unreachable' }` and `triageFindings` turns into an immediate run abort — see the
// Stop Condition note above.
export const fetchUntrackedIssue = (n: number): FetchedIssue | null => {
  try {
    return runGhJson<FetchedIssue>(['issue', 'view', String(n), '--json', 'state,closedAt,title,body']);
  } catch {
    return null;
  }
};

function parseCliArgs(argv: string[]): { dryRun: boolean; ledgerPath: string; queuePath: string } {
  let dryRun = false;
  let ledgerPath = path.join(root, '.blackhole', 'findings-ledger.json');
  let queuePath = path.join(root, '.blackhole', 'queue.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--ledger' && argv[i + 1]) ledgerPath = argv[++i];
    else if (argv[i] === '--queue' && argv[i + 1]) queuePath = argv[++i];
  }
  return { dryRun, ledgerPath, queuePath };
}

function main(): number {
  const { dryRun, ledgerPath, queuePath } = parseCliArgs(process.argv.slice(2));

  if (!fs.existsSync(ledgerPath)) {
    console.error(`Ledger file not found: ${ledgerPath}`);
    return 1;
  }
  const ledger: { findings?: LedgerFinding[]; [key: string]: unknown } = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
  const queue: { issues?: QueueIssues } = fs.existsSync(queuePath) ? JSON.parse(fs.readFileSync(queuePath, 'utf-8')) : { issues: {} };

  const { findings, summary } = triageFindings(ledger.findings ?? [], queue.issues ?? {}, fetchUntrackedIssue);

  console.log(`Examined: ${summary.examined}`);
  console.log(`Resolved: ${summary.resolved}`);
  console.log(`Reopened (flagged manual-triage): ${summary.reopened}`);
  console.log(`Untracked/unreachable: ${summary.untrackedOrUnreachable}`);

  if (summary.aborted) {
    console.error(
      `Aborted: gh issue view failed for #${summary.abortedAt} (rate limit or auth failure) — stopping run, ` +
        'reporting the partial result above rather than risking a false classification. No write performed.',
    );
    return 1;
  }

  if (dryRun) {
    console.log('Dry run — no write performed.');
    return 0;
  }

  const updatedLedger = { ...ledger, findings, refreshed_at: new Date().toISOString() };
  const tmpPath = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(updatedLedger, null, 2));

  const validation = validateStateWrite({ tmpPath, livePath: ledgerPath, entityKey: 'findings' });
  if (!validation.ok) {
    console.error(`state-write-guard refused install: ${validation.reason}`);
    fs.rmSync(tmpPath);
    return 1;
  }

  fs.renameSync(tmpPath, ledgerPath);
  console.log('Ledger updated.');
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
