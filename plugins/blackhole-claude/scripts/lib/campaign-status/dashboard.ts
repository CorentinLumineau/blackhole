import { readScope, type CampaignScope } from '../../forge-scope.ts';
import {
  computeWaves,
  countLedgerByStatus,
  discoveryFilings,
  groupIssuesByPhase,
  renderRouteChain,
} from './queue.ts';
import type {
  CheckpointMeta,
  ConfigSummaryInput,
  ForgeCounts,
  IssueRow,
  LedgerFinding,
  LedgerJson,
  QueueIssue,
  QueueJson,
} from './types.ts';

// One render*Section helper per independently-addable dashboard section — each returns
// the section's lines (including its trailing blank-line separator) or [] when the
// section has nothing to show. Keeps formatDashboard a thin composer (issue #281).

function renderInFlightSection(inFlight: IssueRow[]): string[] {
  if (inFlight.length === 0) return [];
  const lines: string[] = [
    '### In-flight',
    '| Issue | Phase | PR | Notes |',
    '|-------|-------|-----|-------|',
  ];
  for (const { num, issue } of inFlight) {
    const pr = issue.pr != null ? `#${issue.pr}` : '—';
    const notes = issue.notes ? issue.notes.replace(/\|/g, '\\|') : '—';
    lines.push(`| #${num} ${issue.title ?? ''} | ${issue.phase ?? '—'} | ${pr} | ${notes} |`);
  }
  lines.push('');
  return lines;
}

function renderBlockedSection(blocked: IssueRow[]): string[] {
  if (blocked.length === 0) return [];
  const lines: string[] = ['### Blocked'];
  for (const { num, issue } of blocked) {
    lines.push(`- **#${num}** ${issue.title ?? ''} — ${issue.notes ?? 'blocked'}`);
  }
  lines.push('');
  return lines;
}

function renderReadySection(ready: IssueRow[]): string[] {
  if (ready.length === 0) return [];
  return [
    '### Ready',
    ready.map(({ num, issue }) => `#${num} (${issue.phase ?? 'handle'})`).join(', '),
    '',
  ];
}

// Exported: matches the renderLedgerOpenSection precedent — dashboard.test.ts unit-tests the
// SECTION_CAP overflow behavior directly rather than only through formatDashboard.
export function renderRoutingSection(active: IssueRow[]): string[] {
  const routed = active.filter(({ issue }) => issue.route);
  if (routed.length === 0) return [];
  const shown = routed.slice(0, SECTION_CAP);
  const lines: string[] = ['### Routing'];
  for (const { num, issue } of shown) {
    lines.push(`- **#${num}** ${issue.title ?? ''}`);
    lines.push(`  ${renderRouteChain(issue.route, issue.phase)}`);
  }
  lines.push(...capOverflowLine(routed.length, shown.length));
  lines.push('');
  return lines;
}

export function renderWavesSection(issues: Record<string, QueueIssue>): string[] {
  const { waves, unresolved } = computeWaves(issues);
  if (waves.length === 0 && unresolved.length === 0) return [];
  const shown = waves.slice(0, SECTION_CAP);
  const lines: string[] = ['### Waves'];
  shown.forEach((wave, i) => {
    lines.push(`**Wave ${i}:** ${wave.map((n) => `#${n}`).join(', ')}`);
  });
  lines.push(...capOverflowLine(waves.length, shown.length));
  if (unresolved.length > 0) {
    lines.push(`**Unresolved (dependency cycle):** ${unresolved.map((n) => `#${n}`).join(', ')}`);
  }
  lines.push('');
  return lines;
}

function renderCompletedSection(done: IssueRow[]): string[] {
  if (done.length === 0) return [];
  return [
    '### Completed (queue)',
    done
      .map(({ num, issue }) => `#${num}${issue.pr != null ? ` → PR #${issue.pr}` : ''}`)
      .join(' · '),
    '',
  ];
}

function renderFiledSection(filed: ReturnType<typeof discoveryFilings>): string[] {
  if (filed.length === 0) return [];
  const lines: string[] = ['### Issues filed (deferred discoveries)'];
  for (const f of filed) {
    lines.push(`- **#${f.issue}** — ${f.summary} (\`${f.vcode}\`)`);
  }
  lines.push('');
  return lines;
}

// Shared cap idiom for the three list-rendering sections that can grow unbounded (Routing,
// Waves, Ledger open): show the first SECTION_CAP entries, then point at the rest instead of
// dumping them all — one behavior, one wording, reused at every call site (V-DRY-01 / V-INT-02).
export const SECTION_CAP = 10;

export function capOverflowLine(totalCount: number, shownCount: number): string[] {
  return totalCount > shownCount ? [`- …and ${totalCount - shownCount} more`] : [];
}

// ADR-042 — severity rank for the open-section sort below: BLOCK before WARN
// before NOTE, anything else last.
const LEDGER_SEVERITY_RANK: Record<string, number> = { BLOCK: 0, WARN: 1, NOTE: 2 };
const ledgerSeverityRank = (severity?: string): number => LEDGER_SEVERITY_RANK[severity ?? ''] ?? 3;

// Recency key for the sort's tiebreak: last_seen_at when present (a hook-derived row bumped by
// a repeat), else created_at, else 0 (sorts last within its severity tier rather than throwing).
const ledgerRecencyKey = (f: LedgerFinding): number => {
  const ts = f.last_seen_at ?? f.created_at;
  if (!ts) return 0;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : parsed;
};

// Exported: ADR-042 Task 2(d)/(e) unit-test this directly, not only through formatDashboard.
export function renderLedgerOpenSection(findings: LedgerFinding[]): string[] {
  const openFindings = findings
    .filter((f) => f.status === 'open')
    .slice()
    .sort((a, b) => {
      const rankDiff = ledgerSeverityRank(a.severity) - ledgerSeverityRank(b.severity);
      if (rankDiff !== 0) return rankDiff;
      return ledgerRecencyKey(b) - ledgerRecencyKey(a);
    });
  if (openFindings.length === 0) return [];
  const shown = openFindings.slice(0, SECTION_CAP);
  const lines: string[] = ['### Ledger open'];
  for (const f of shown) {
    const occSuffix = f.occurrences != null ? ` ×${f.occurrences}` : '';
    const issueSuffix = f.issue_ref != null ? ` (#${f.issue_ref})` : '';
    const seenSuffix = f.last_seen_at ? ` (last seen ${f.last_seen_at})` : '';
    lines.push(
      `- **${f.id ?? '?'}** \`${f.vcode}\` ${f.severity} — ${f.summary ?? ''}${occSuffix}${issueSuffix}${seenSuffix}`,
    );
  }
  lines.push(...capOverflowLine(openFindings.length, shown.length));
  lines.push('');
  return lines;
}

function renderActiveWorkersSection(checkpointBody: string | undefined): string[] {
  if (!checkpointBody?.includes('## In-flight workers')) return [];
  const workerSection = checkpointBody
    .split('## In-flight workers')[1]
    ?.split(/^## /m)[0]
    ?.trim();
  if (!workerSection) return [];
  return ['### Active workers', workerSection, ''];
}

// Single scope-label formatter, shared by the dashboard header and renderConfigSummary so the
// two can never drift into two wordings for the same scope (V-DRY-01 / V-INT-02).
export function formatScopeLabel(scope?: CampaignScope): string {
  if (scope?.milestone) return `milestone **${scope.milestone}**`;
  if (scope?.labels?.length) return `labels ${scope.labels.map((l) => `\`${l}\``).join(', ')}`;
  return 'all open issues';
}

const onOff = (v: boolean | undefined, dflt: boolean): string => ((v ?? dflt) ? 'on' : 'off');
const enabledLabel = (v: boolean | undefined, dflt: boolean): string =>
  (v ?? dflt) ? 'enabled' : 'disabled';

/**
 * Human-readable summary of the campaign-shaping config fields, for the routine-resume
 * confirmation gate (coordinator.md § Bootstrap preflight). Defaults mirror config-template.md,
 * with one deliberate exception: `merge_mode` has no default (ruling R-002,
 * `documentation/reference/product-principles.md`) — an absent value renders as an explicit
 * unset sentinel rather than silently falling back to `"immediate"`.
 * Deliberately NOT folded into formatDashboard(): `bun run status` runs on every orchestrator
 * turn, and this belongs at launch confirmation only.
 */
export function renderConfigSummary(config: ConfigSummaryInput): string {
  const kz = config.kaizen?.enabled ?? false;

  return [
    '## Campaign configuration',
    '',
    `**Scope:** ${formatScopeLabel(readScope(config))}`,
    `**Merge mode:** ${config.merge_mode ?? 'unset (bootstrap-blocking)'}`,
    `**Parallel max:** ${config.parallel_max ?? 4}`,
    `**Kaizen:** ${enabledLabel(kz, false)}`,
    // Absent block, absent field, or explicit `false` all render "disabled" — SSOT:
    // config-template.md's `docs_governance.enabled` row (issue #477).
    `**Docs governance:** ${enabledLabel(config.docs_governance?.enabled, false)}`,
    ...(config.docs_governance?.enabled
      ? [
          `**Docs governance.companion_files:** ${enabledLabel(config.docs_governance.companion_files, true)}`,
          `**Docs governance.docs_impact_routing:** ${enabledLabel(config.docs_governance.docs_impact_routing, true)}`,
          `**Docs governance.write_governance:** ${enabledLabel(config.docs_governance.write_governance, true)}`,
        ]
      : []),
    `**Incident mode:** ${enabledLabel(config.incident_mode?.enabled, false)}`,
    `**Worker model policy:** ${config.worker_model_policy ?? 'cost-optimized'}`,
    `**Auto-sync:** ${onOff(config.auto_sync, true)} · **Adaptive routing:** ${onOff(config.adaptive_routing, true)}`,
  ].join('\n');
}

export type QueueHealth = 'healthy' | 'stalled' | 'degraded';

/**
 * Queue health verdict for the dashboard's Counts block. Deliberately narrow: inputs are the
 * three counts `formatDashboard()` already has in hand (forge availability, blocked count,
 * in-flight count) — not plugin-drift or doc-health. Both of those are read and rendered
 * elsewhere (`main()` calls `renderPluginDriftWarning()` after `formatDashboard()`, and
 * `.blackhole/doc-health.json` is never read by `bun run status` at all), so folding either into
 * this verdict would either add a file-read dependency `formatDashboard()` doesn't have today or
 * assert something true about a signal this function cannot see. The label stays scoped to what
 * it actually covers rather than reading as a summary that subsumes state it knows nothing about.
 *
 * Priority order is load-bearing: an unreachable forge means the counts below cannot be trusted,
 * so `degraded` is checked first and overrides everything else regardless of blocked/in-flight.
 */
export function computeQueueHealth(input: {
  forgeOk: boolean;
  blockedCount: number;
  inFlightCount: number;
}): QueueHealth {
  if (!input.forgeOk) return 'degraded';
  if (input.blockedCount > 0 && input.inFlightCount === 0) return 'stalled';
  return 'healthy';
}

const QUEUE_HEALTH_ICON: Record<QueueHealth, string> = {
  healthy: '✓',
  stalled: '⚠',
  degraded: '✗',
};

export function renderQueueHealthLine(verdict: QueueHealth, blockedCount: number): string {
  const label = verdict.toUpperCase();
  if (verdict === 'stalled') {
    return `**Queue health:** ${QUEUE_HEALTH_ICON[verdict]} ${label} (${blockedCount} blocked, none in-flight)`;
  }
  if (verdict === 'degraded') {
    return `**Queue health:** ${QUEUE_HEALTH_ICON[verdict]} ${label} (forge unavailable)`;
  }
  return `**Queue health:** ${QUEUE_HEALTH_ICON[verdict]} ${label}`;
}

export function formatDashboard(opts: {
  scope?: CampaignScope;
  checkpoint: CheckpointMeta;
  queue: QueueJson;
  ledger: LedgerJson;
  forge: ForgeCounts;
  checkpointBody?: string;
}): string {
  const { scope, checkpoint, queue, ledger, forge, checkpointBody } = opts;
  const issues = queue.issues ?? {};
  const findings = ledger.findings ?? [];
  const { active, done, inFlight, blocked, ready } = groupIssuesByPhase(issues);
  const ledgerCounts = countLedgerByStatus(findings);
  const filed = discoveryFilings(findings);
  const scopeLabel = formatScopeLabel(scope);

  const lines: string[] = [];

  lines.push('## Campaign status');
  lines.push('');
  lines.push(
    `**Scope:** ${scopeLabel} · **Turn:** ${checkpoint.orchestrator_turn_id ?? '—'} · **Queue refreshed:** ${queue.refreshed_at ?? '—'}`,
  );
  lines.push('');

  if (forge.ok) {
    lines.push(
      `**Forge:** ${forge.openIssues} open issue${forge.openIssues === 1 ? '' : 's'} · ${forge.openPrs} open PR${forge.openPrs === 1 ? '' : 's'}`,
    );
  } else {
    lines.push(`**Forge:** unavailable (${forge.error ?? 'gh failed'})`);
  }
  lines.push(
    `**Queue:** ${active.length} active · ${done.length} done · ${inFlight.length} in-flight · ${blocked.length} blocked · ${ready.length} ready`,
  );
  lines.push(
    `**Ledger:** ${ledgerCounts.open} open (BLOCK ${ledgerCounts.block} · WARN ${ledgerCounts.warn} · NOTE ${ledgerCounts.note}) · ${ledgerCounts.deferred} deferred`,
  );
  const queueHealth = computeQueueHealth({
    forgeOk: forge.ok,
    blockedCount: blocked.length,
    inFlightCount: inFlight.length,
  });
  lines.push(renderQueueHealthLine(queueHealth, blocked.length));
  lines.push('');

  lines.push(...renderInFlightSection(inFlight));
  lines.push(...renderBlockedSection(blocked));
  lines.push(...renderReadySection(ready));
  lines.push(...renderRoutingSection(active));
  lines.push(...renderWavesSection(issues));
  lines.push(...renderCompletedSection(done));
  lines.push(...renderFiledSection(filed));
  lines.push(...renderLedgerOpenSection(findings));
  lines.push(...renderActiveWorkersSection(checkpointBody));

  return lines.join('\n').trimEnd();
}
