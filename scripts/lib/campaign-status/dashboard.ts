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

function renderRoutingSection(active: IssueRow[]): string[] {
  const routed = active.filter(({ issue }) => issue.route);
  if (routed.length === 0) return [];
  const lines: string[] = ['### Routing'];
  for (const { num, issue } of routed) {
    lines.push(`- **#${num}** ${issue.title ?? ''}`);
    lines.push(`  ${renderRouteChain(issue.route, issue.phase)}`);
  }
  lines.push('');
  return lines;
}

function renderWavesSection(issues: Record<string, QueueIssue>): string[] {
  const { waves, unresolved } = computeWaves(issues);
  if (waves.length === 0 && unresolved.length === 0) return [];
  const lines: string[] = ['### Waves'];
  waves.forEach((wave, i) => {
    lines.push(`**Wave ${i}:** ${wave.map((n) => `#${n}`).join(', ')}`);
  });
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

function renderLedgerOpenSection(findings: LedgerFinding[]): string[] {
  const openFindings = findings.filter((f) => f.status === 'open');
  if (openFindings.length === 0) return [];
  const lines: string[] = ['### Ledger open'];
  for (const f of openFindings.slice(0, 10)) {
    lines.push(
      `- **${f.id ?? '?'}** \`${f.vcode}\` ${f.severity} — ${f.summary ?? ''}${f.issue_ref != null ? ` (#${f.issue_ref})` : ''}`,
    );
  }
  if (openFindings.length > 10) {
    lines.push(`- …and ${openFindings.length - 10} more`);
  }
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
    `**Docs governance:** ${enabledLabel(config.docs_governance?.enabled, true)}`,
    `**Incident mode:** ${enabledLabel(config.incident_mode?.enabled, false)}`,
    `**Worker model policy:** ${config.worker_model_policy ?? 'cost-optimized'}`,
    `**Auto-sync:** ${onOff(config.auto_sync, true)} · **Adaptive routing:** ${onOff(config.adaptive_routing, true)}`,
  ].join('\n');
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
