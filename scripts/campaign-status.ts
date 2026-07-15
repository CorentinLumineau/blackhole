import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { readScope, buildListArgs, type CampaignScope } from './forge-scope';

const root = path.resolve(import.meta.dirname, '..');

// Mirrors the `route` object SSOT — `queue-dag.md` § `route` object. Field names and enum
// values are frozen there; this type must not rename or add fields (V-INT-01 / V-DRY-01).
export type Route = {
  needs_split?: boolean;
  needs_clarification?: boolean;
  needs_research?: boolean;
  needs_investigation?: boolean;
  needs_design?: boolean;
  task_type?: 'feature' | 'bugfix' | 'refactor' | 'docs';
  plan_mode?: 'skip' | 'quick' | 'full';
  security_review_required?: boolean;
  confidence?: { split?: number; design?: number; plan_mode?: number; security?: number };
  body_hash?: string;
  computed_at_phase?: 'handle' | 'plan' | 'implement' | 'review';
  revision?: number;
};

export type QueueIssue = {
  title?: string;
  phase?: string;
  status?: string;
  pr?: number | null;
  notes?: string | null;
  depends_on?: number[];
  size?: string;
  review_iteration?: number;
  route?: Route;
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

// Terminal queue statuses — single source shared by every "is this issue active?" check
// (groupIssuesByPhase, computeWaves). Adding a new terminal status here keeps the dashboard
// sections and the wave computation in agreement (prevents a silent active/done split).
export const DONE_STATUSES = ['merged', 'closed'];

const isDone = (issue: QueueIssue) => DONE_STATUSES.includes(issue.status ?? '');

export function groupIssuesByPhase(issues: Record<string, QueueIssue>) {
  const rows: { num: number; issue: QueueIssue }[] = Object.entries(issues)
    .map(([num, issue]) => ({ num: Number(num), issue }))
    .sort((a, b) => a.num - b.num);

  const active = rows.filter((r) => !isDone(r.issue));
  const done = rows.filter((r) => isDone(r.issue));
  const inFlight = active.filter((r) => r.issue.status === 'in-flight');
  const blocked = active.filter((r) => r.issue.status === 'blocked');
  const ready = active.filter((r) => r.issue.status === 'ready');

  return { active, done, inFlight, blocked, ready };
}

// Render the PLANNED conditional route chain for one issue, marking the current phase.
// Honest scope: this shows the planned path + where the issue currently is — NOT a
// reconstructed history of the actual path taken (route{} carries no transition log).
export function renderRouteChain(
  route: Route | undefined,
  phase: string | undefined,
): string {
  if (!route) return '(not yet routed)';

  const mark = (label: string, stepPhase?: string) =>
    stepPhase && stepPhase === phase ? `▸${label}◂` : label;

  const steps: string[] = [];
  if (route.needs_split) {
    // A true split voids every sibling flag — children re-enter with their own route.
    steps.push(mark('Handle', 'handle'), 'Split', '(children re-enter)');
  } else {
    steps.push(mark('Handle', 'handle'));
    if (route.needs_research) steps.push('research');
    if (route.needs_investigation) steps.push('investigate');
    if (route.needs_design) steps.push('design-gate');
    steps.push(mark(`Plan(${route.plan_mode ?? 'full'})`, 'plan'));
    steps.push(mark('Implement', 'implement'));
    steps.push(mark(route.security_review_required ? 'Review(security)' : 'Review', 'review'));
  }

  const chain = steps.join(' → ');

  const c = route.confidence;
  const conf = c
    ? [
        c.split != null ? `split:${c.split}` : null,
        c.design != null ? `design:${c.design}` : null,
        c.plan_mode != null ? `plan:${c.plan_mode}` : null,
        c.security != null ? `sec:${c.security}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return conf ? `${chain}  ·  conf ${conf}` : chain;
}

// Compute display execution waves via topological sort on `depends_on`, mirroring
// `queue-dag.md` § Step 4 semantics (Wave 0 = no unsatisfied deps; Wave N = deps placed
// in prior waves). Merged/closed issues are excluded and count as already-satisfied deps.
// Unresolvable issues (dependency cycles) are surfaced in `unresolved`, never dropped.
//
// Known limitation: a `depends_on` id that is absent from `issues` (e.g. a cross-scope
// dependency outside the campaign's milestone/label filter) is treated as satisfied — this
// is display-only and cannot see forge state for out-of-scope issues. Scheduling readiness
// (queue-dag.md § Step 2) still consults the forge; this function only groups in-scope work.
export function computeWaves(issues: Record<string, QueueIssue>): {
  waves: number[][];
  unresolved: number[];
} {
  const active = Object.entries(issues)
    .map(([num, issue]) => ({ num: Number(num), issue }))
    .filter((r) => !isDone(r.issue));
  const activeNums = new Set(active.map((r) => r.num));

  const placed = new Set<number>();
  const waves: number[][] = [];
  let remaining = active.map((r) => r.num);

  while (remaining.length > 0) {
    const wave = remaining.filter((num) => {
      const deps = issues[String(num)].depends_on ?? [];
      // A dep blocks only if it is another active issue not yet placed in a prior wave.
      return deps.every((d) => !activeNums.has(d) || placed.has(d));
    });
    if (wave.length === 0) break; // dependency cycle — remaining are unresolvable
    wave.sort((a, b) => a - b);
    waves.push(wave);
    wave.forEach((n) => placed.add(n));
    remaining = remaining.filter((n) => !placed.has(n));
  }

  return { waves, unresolved: remaining.sort((a, b) => a - b) };
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

type IssueRow = { num: number; issue: QueueIssue };

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
