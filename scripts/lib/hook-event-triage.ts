import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './fs.ts';
import { validateStateWrite } from './state-write-guard.ts';
import { root } from '../checks/check-utils.ts';

/** Minimal queue issue shape for worktree → issue_ref resolution during Triage 1b. */
export type QueueIssueForTriage = {
  status?: string;
  worktree?: string | null;
};

export type LedgerFinding = {
  id: string;
  vcode: string;
  severity: 'BLOCK' | 'WARN' | 'NOTE';
  phase: string;
  issue_ref: number | null;
  pr_ref: number | null;
  file: string;
  line: number;
  summary: string;
  status: string;
  deferred_to_issue: number | null;
  created_at: string;
  resolved_at: string | null;
  // ADR-042 — hook-derived rows only: how many events collapsed into this row,
  // and when the most recent one arrived. Optional/additive — findLedgerSchemaDrift never
  // rejects an unknown key (ledger-schema.check.ts:35).
  occurrences?: number;
  last_seen_at?: string;
};

export type FindingsLedger = {
  refreshed_at: string;
  next_id: number;
  findings: LedgerFinding[];
};

type HookEvent = {
  tier?: string;
  reason?: string;
  worktree?: string | null;
  pattern_id?: string;
  hook?: string;
  detail?: string;
};

const TIER_VCODE: Record<string, { vcode: string; severity: 'BLOCK' | 'WARN' }> = {
  block: { vcode: 'V-HOOK-01', severity: 'BLOCK' },
  warn: { vcode: 'V-HOOK-02', severity: 'WARN' },
  error: { vcode: 'V-HOOK-03', severity: 'BLOCK' },
};

// ADR-042 — the shared key composition (vcode, file, line, issue_ref) is unchanged; what
// changes is what `file` holds for a hook-derived row (see classIdentityFile below).
const findingDedupKey = (finding: Pick<LedgerFinding, 'vcode' | 'file' | 'line' | 'issue_ref'>): string =>
  `${finding.vcode}\0${finding.file}\0${finding.line}\0${finding.issue_ref ?? ''}`;

// Only an `open` hook-derived row is a dedup target (ADR-042) — admitting `deferred` here made
// a deferred class a permanent silent sink: every later recurrence bumped a counter no
// dashboard section ever rendered.
const isDedupCandidate = (status: string): boolean => status === 'open';

const resolveWorktreePath = (worktree: string): string => {
  try {
    return fs.realpathSync(path.resolve(worktree));
  } catch {
    return path.resolve(worktree);
  }
};

/** Match a hook event's `worktree` against in-flight queue entries (orchestrator-runtime.md § Triage 1b). */
export const resolveIssueRefFromWorktree = (
  worktree: string | null | undefined,
  queueIssues: Record<string, QueueIssueForTriage>,
): number | null => {
  if (worktree == null || worktree === '') return null;
  const eventRoot = resolveWorktreePath(worktree);
  for (const [issueNum, issue] of Object.entries(queueIssues)) {
    if (issue.status !== 'in-flight' || issue.worktree == null || issue.worktree === '') continue;
    if (resolveWorktreePath(issue.worktree) === eventRoot) return Number(issueNum);
  }
  return null;
};

const formatFindingId = (nextId: number): string => `F-${String(nextId).padStart(5, '0')}`;

// Owner-ruled finding identity (ADR-042): `(vcode, pattern_id, worktree)`, not
// `(hook, pattern_id)` and not the originating event's filename. This is a synthetic identity
// string, not a filesystem path — `<worktree-key>` is the resolved worktree root, or the
// literal `no-worktree` when the event carries none. `pattern_id` is length-prefixed
// (netstring-style, `<len>:<pattern_id>`) ahead of the separator so a `pattern_id` containing a
// literal `/` can never be mistaken for the pattern_id/worktree-key boundary — e.g. pattern_id
// "foo/" + worktree `null` and pattern_id "foo" + worktree "/no-worktree" would otherwise both
// collapse to "foo//no-worktree". The length prefix leaves `worktree-key` itself untouched and
// readable in the ledger.
const classIdentityFile = (patternId: string, worktree: string | null | undefined): string => {
  const worktreeKey = worktree ? resolveWorktreePath(worktree) : 'no-worktree';
  return `.blackhole/hook-events/${patternId.length}:${patternId}/${worktreeKey}`;
};

/**
 * Glob `.blackhole/hook-events/*.json`, map tiers to V-HOOK-0N findings, dedup-append to the
 * ledger by class identity (ADR-042), and archive each consumed file — mechanical
 * implementation of orchestrator-runtime.md § Triage step 1b and § Session resume & recovery
 * step 6.
 */
export const ingestHookEvents = ({
  repoRoot,
  queueIssues,
  ledger,
}: {
  repoRoot: string;
  queueIssues: Record<string, QueueIssueForTriage>;
  ledger: FindingsLedger;
}): { ingested: number; ledger: FindingsLedger } => {
  const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
  if (!fs.existsSync(eventsDir)) return { ingested: 0, ledger };

  const eventFiles = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.json'));
  if (eventFiles.length === 0) return { ingested: 0, ledger };

  // Clone every row so an in-place occurrence bump never mutates the caller's ledger object.
  const findings = ledger.findings.map((f) => ({ ...f }));
  const byKey = new Map<string, LedgerFinding>();
  for (const f of findings) {
    if (isDedupCandidate(f.status)) byKey.set(findingDedupKey(f), f);
  }

  let nextId = ledger.next_id;
  let ingested = 0;
  const now = new Date().toISOString();
  // ADR-042 item 4 — archive-then-delete: a consumed event is moved, never unlinked, so it
  // survives even after its ledger row collapses into a class-level occurrence count. One
  // archive directory per ingest run.
  const archiveDir = path.join(repoRoot, '.blackhole', 'archive', `hook-events-${Date.now()}`);
  let archiveDirEnsured = false;

  for (const filename of eventFiles) {
    const filePath = path.join(eventsDir, filename);
    let event: HookEvent;
    try {
      event = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HookEvent;
    } catch {
      continue;
    }

    const tier = event.tier ?? '';
    const mapping = TIER_VCODE[tier];
    if (!mapping) continue;

    const patternId = event.pattern_id ?? 'unknown';
    const issueRef = resolveIssueRefFromWorktree(event.worktree, queueIssues);
    const classFile = classIdentityFile(patternId, event.worktree);
    const reasonText = event.reason ?? `${event.hook ?? 'hook'}: ${patternId}`;
    // ADR-042 item 5 — carry the already-redacted `event.detail` into the row so a collapsed
    // class is still diagnosable (no schema field added; folded into `summary`).
    const summary = event.detail ? `${reasonText} — ${event.detail}` : reasonText;

    const key = findingDedupKey({ vcode: mapping.vcode, file: classFile, line: 0, issue_ref: issueRef });
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences = (existing.occurrences ?? 1) + 1;
      existing.last_seen_at = now;
    } else {
      const candidate: LedgerFinding = {
        id: formatFindingId(nextId),
        vcode: mapping.vcode,
        severity: mapping.severity,
        phase: 'implement',
        issue_ref: issueRef,
        pr_ref: null,
        file: classFile,
        line: 0,
        summary,
        status: 'open',
        deferred_to_issue: null,
        created_at: now,
        resolved_at: null,
        occurrences: 1,
        last_seen_at: now,
      };
      nextId += 1;
      findings.push(candidate);
      byKey.set(key, candidate);
    }

    if (!archiveDirEnsured) {
      fs.mkdirSync(archiveDir, { recursive: true });
      archiveDirEnsured = true;
    }
    fs.renameSync(filePath, path.join(archiveDir, filename));
    ingested += 1;
  }

  if (ingested === 0) return { ingested: 0, ledger };

  return {
    ingested,
    ledger: {
      ...ledger,
      refreshed_at: now,
      next_id: nextId,
      findings,
    },
  };
};

// CLI entrypoint — existence-gated turn-start trigger
// (orchestrator-runtime.md § Session resume & recovery step 6) invokes this script directly,
// mirroring doc-health-signal.ts / plugin-drift-signal.ts's existence-gated,
// fully-recomputed-every-turn idiom. Unlike those two, this script mutates
// findings-ledger.json, so it goes through the full write protocol (blackhole-state.md §
// Write protocol): snapshot to archive/, write .tmp, validateStateWrite, atomic rename.
// `deps.validateStateWrite` defaults to the real guard; a test can inject a stub that forces
// `{ ok: false }` to exercise the refusal branch (fs.renameSync must never run, exit code must
// be non-zero) without needing a genuinely guard-rejecting ledger — the real write-protocol
// flow only ever grows the findings count, so a real rejection cannot be manufactured here.
export function main(deps: { validateStateWrite: typeof validateStateWrite } = { validateStateWrite }): void {
  const campaignDir = path.join(root, '.blackhole');
  const ledgerPath = path.join(campaignDir, 'findings-ledger.json');
  const queuePath = path.join(campaignDir, 'queue.json');

  if (!fs.existsSync(ledgerPath)) {
    console.log('hook-event-triage: no findings-ledger.json — nothing to ingest into');
    return;
  }

  const queueIssues = fs.existsSync(queuePath)
    ? (((readJsonFile(queuePath, queuePath) as { issues?: Record<string, QueueIssueForTriage> }).issues) ?? {})
    : {};
  const ledger = readJsonFile(ledgerPath, ledgerPath) as FindingsLedger;

  const { ingested, ledger: updated } = ingestHookEvents({ repoRoot: root, queueIssues, ledger });
  if (ingested === 0) {
    console.log('hook-event-triage: no hook events to ingest');
    return;
  }

  const archiveDir = path.join(campaignDir, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, `findings-ledger-${Date.now()}.json`), fs.readFileSync(ledgerPath));

  const tmpPath = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(updated, null, 2)}\n`);

  const guardResult = deps.validateStateWrite({ tmpPath, livePath: ledgerPath, entityKey: 'findings' });
  if (!guardResult.ok) {
    fs.rmSync(tmpPath, { force: true });
    console.error(`hook-event-triage: write guard refused install — ${guardResult.reason}`);
    process.exitCode = 1;
    return;
  }

  fs.renameSync(tmpPath, ledgerPath);
  console.log(`hook-event-triage: ingested ${ingested} event(s) into ${updated.findings.length} total findings`);
}

if (import.meta.main) {
  main();
}
