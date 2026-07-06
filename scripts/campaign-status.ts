import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { readScope, buildListArgs, type CampaignScope } from './forge-scope';

const root = path.resolve(import.meta.dirname, '..');

export type QueueIssue = {
  title?: string;
  phase?: string;
  status?: string;
  pr?: number | null;
  notes?: string | null;
  depends_on?: number[];
  size?: string;
  review_iteration?: number;
};

export type QueueJson = {
  refreshed_at?: string;
  campaign_started_at?: string;
  issues?: Record<string, QueueIssue>;
};

export type LedgerFinding = {
  id?: string;
  vcode?: string;
  severity?: string;
  status?: string;
  summary?: string;
  deferred_to_issue?: number | null;
  issue_ref?: number | null;
};

export type LedgerJson = {
  refreshed_at?: string;
  findings?: LedgerFinding[];
};

export type CheckpointMeta = {
  orchestrator_turn_id?: number;
  last_completed_phase?: string;
  refreshed_at?: string;
};

export type ForgeCounts = {
  openIssues: number;
  openPrs: number;
  ok: boolean;
  error?: string;
};

export function parseCheckpointFrontmatter(content: string): CheckpointMeta {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const meta: CheckpointMeta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === 'orchestrator_turn_id') meta.orchestrator_turn_id = Number(val);
    else if (key === 'last_completed_phase') meta.last_completed_phase = val;
    else if (key === 'refreshed_at') meta.refreshed_at = val;
  }
  return meta;
}

export function countLedgerByStatus(findings: LedgerFinding[]) {
  const open = findings.filter((f) => f.status === 'open');
  const deferred = findings.filter((f) => f.status === 'deferred');
  const block = open.filter((f) => f.severity === 'BLOCK').length;
  const warn = open.filter((f) => f.severity === 'WARN').length;
  const note = open.filter((f) => f.severity === 'NOTE' || f.severity === 'INFO').length;
  return { open: open.length, deferred: deferred.length, block, warn, note };
}

export function groupIssuesByPhase(issues: Record<string, QueueIssue>) {
  const rows: { num: number; issue: QueueIssue }[] = Object.entries(issues)
    .map(([num, issue]) => ({ num: Number(num), issue }))
    .sort((a, b) => a.num - b.num);

  const active = rows.filter(
    (r) => !['merged', 'closed'].includes(r.issue.status ?? ''),
  );
  const done = rows.filter((r) =>
    ['merged', 'closed'].includes(r.issue.status ?? ''),
  );
  const inFlight = active.filter((r) => r.issue.status === 'in-flight');
  const blocked = active.filter((r) => r.issue.status === 'blocked');
  const ready = active.filter((r) => r.issue.status === 'ready');

  return { active, done, inFlight, blocked, ready };
}

export function discoveryFilings(findings: LedgerFinding[]) {
  return findings
    .filter((f) => f.status === 'deferred' && f.deferred_to_issue != null)
    .map((f) => ({
      issue: f.deferred_to_issue as number,
      summary: f.summary ?? '',
      vcode: f.vcode ?? '',
    }));
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
  const scopeLabel = scope?.milestone
    ? `milestone **${scope.milestone}**`
    : scope?.labels?.length
      ? `labels ${scope.labels.map((l) => `\`${l}\``).join(', ')}`
      : 'all open issues';

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

  if (inFlight.length > 0) {
    lines.push('### In-flight');
    lines.push('| Issue | Phase | PR | Notes |');
    lines.push('|-------|-------|-----|-------|');
    for (const { num, issue } of inFlight) {
      const pr = issue.pr != null ? `#${issue.pr}` : '—';
      const notes = issue.notes ? issue.notes.replace(/\|/g, '\\|') : '—';
      lines.push(`| #${num} ${issue.title ?? ''} | ${issue.phase ?? '—'} | ${pr} | ${notes} |`);
    }
    lines.push('');
  }

  if (blocked.length > 0) {
    lines.push('### Blocked');
    for (const { num, issue } of blocked) {
      lines.push(`- **#${num}** ${issue.title ?? ''} — ${issue.notes ?? 'blocked'}`);
    }
    lines.push('');
  }

  if (ready.length > 0) {
    lines.push('### Ready');
    lines.push(
      ready.map(({ num, issue }) => `#${num} (${issue.phase ?? 'handle'})`).join(', '),
    );
    lines.push('');
  }

  if (done.length > 0) {
    lines.push('### Completed (queue)');
    lines.push(
      done
        .map(({ num, issue }) => `#${num}${issue.pr != null ? ` → PR #${issue.pr}` : ''}`)
        .join(' · '),
    );
    lines.push('');
  }

  if (filed.length > 0) {
    lines.push('### Issues filed (deferred discoveries)');
    for (const f of filed) {
      lines.push(`- **#${f.issue}** — ${f.summary} (\`${f.vcode}\`)`);
    }
    lines.push('');
  }

  const openFindings = findings.filter((f) => f.status === 'open');
  if (openFindings.length > 0) {
    lines.push('### Ledger open');
    for (const f of openFindings.slice(0, 10)) {
      lines.push(
        `- **${f.id ?? '?'}** \`${f.vcode}\` ${f.severity} — ${f.summary ?? ''}${f.issue_ref != null ? ` (#${f.issue_ref})` : ''}`,
      );
    }
    if (openFindings.length > 10) {
      lines.push(`- …and ${openFindings.length - 10} more`);
    }
    lines.push('');
  }

  if (checkpointBody?.includes('## In-flight workers')) {
    const workerSection = checkpointBody
      .split('## In-flight workers')[1]
      ?.split(/^## /m)[0]
      ?.trim();
    if (workerSection) {
      lines.push('### Active workers');
      lines.push(workerSection);
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}

export function fetchForgeCounts(scope: CampaignScope, repo: string): ForgeCounts {
  const listArgs = buildListArgs(scope);
  const issueRes = spawnSync(
    'gh',
    ['issue', 'list', '--state', 'open', '--repo', repo, '--json', 'number', ...listArgs],
    { encoding: 'utf-8' },
  );
  const prRes = spawnSync(
    'gh',
    ['pr', 'list', '--state', 'open', '--repo', repo, '--json', 'number'],
    { encoding: 'utf-8' },
  );

  if (issueRes.status !== 0) {
    return {
      openIssues: 0,
      openPrs: 0,
      ok: false,
      error: issueRes.stderr?.trim() || issueRes.stdout?.trim() || 'issue list failed',
    };
  }

  let openIssues = 0;
  let openPrs = 0;
  try {
    openIssues = JSON.parse(issueRes.stdout || '[]').length;
    openPrs = prRes.status === 0 ? JSON.parse(prRes.stdout || '[]').length : 0;
  } catch {
    return { openIssues: 0, openPrs: 0, ok: false, error: 'invalid gh JSON' };
  }

  return { openIssues, openPrs, ok: true };
}

export function loadCampaignState(campaignDir: string) {
  const configPath = path.join(campaignDir, 'config.json');
  const queuePath = path.join(campaignDir, 'queue.json');
  const ledgerPath = path.join(campaignDir, 'findings-ledger.json');
  const checkpointPath = path.join(campaignDir, 'campaign-checkpoint.md');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    repo?: string;
    scope_milestone?: string;
    scope_labels?: string[];
  };
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as QueueJson;
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8')) as LedgerJson;

  let checkpoint: CheckpointMeta = {};
  let checkpointBody = '';
  if (fs.existsSync(checkpointPath)) {
    const raw = fs.readFileSync(checkpointPath, 'utf-8');
    checkpoint = parseCheckpointFrontmatter(raw);
    checkpointBody = raw;
  }

  return { config, queue, ledger, checkpoint, checkpointBody };
}

function main() {
  const args = process.argv.slice(2);
  let campaignDir = path.join(root, '.blackhole');
  let skipGh = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--campaign-dir' && args[i + 1]) {
      campaignDir = path.isAbsolute(args[i + 1])
        ? args[i + 1]
        : path.join(root, args[i + 1]);
      i++;
    } else if (args[i] === '--no-gh') {
      skipGh = true;
    }
  }

  const { config, queue, ledger, checkpoint, checkpointBody } =
    loadCampaignState(campaignDir);
  const scope = readScope(config);

  const forge = skipGh
    ? { openIssues: 0, openPrs: 0, ok: false, error: 'skipped' }
    : fetchForgeCounts(scope, config.repo ?? '');

  const dashboard = formatDashboard({
    scope,
    checkpoint,
    queue,
    ledger,
    forge,
    checkpointBody,
  });

  console.log(dashboard);
}

if (import.meta.main) {
  main();
}
