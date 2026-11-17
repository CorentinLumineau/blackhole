import { readScope } from '../../forge-scope.ts';
import { resolveUsageBudget } from '../usage-budget.ts';
import type { BudgetView } from './budget.ts';
import { formatScopeLabel } from './dashboard.ts';
import type { ConfigSummaryInput, StatusReport } from './types.ts';

// The executive-summary launch gate (`launch-gate.md`): one row per section, each with a one-line
// consequence, and the Accept / Adjust question cards built from those rows. Pure: every input is
// already read; `scripts/campaign-status.ts --summary` does the I/O.

export const LAUNCH_ROW_KEYS = ['scope', 'order', 'merge', 'budget', 'status_page', 'kaizen_staging', 'peers'] as const;
export type LaunchRowKey = (typeof LAUNCH_ROW_KEYS)[number];

/** A consequence must read on its own on a card line. */
export const MAX_CONSEQUENCE_CHARS = 140;
/** A probe younger than this counts as current; older, the page is probed again. */
export const PROBE_FRESH_MINUTES = 10;
/** Questions one card carries. */
export const QUESTIONS_PER_CARD = 4;

export type GateOption = { label: string; description: string };

export type LaunchRow = {
  key: LaunchRowKey;
  label: string;
  /** Short card header (12 characters at most). */
  header: string;
  value: string;
  consequence: string;
  /** False for a display-only row, which never becomes a question. */
  adjustable: boolean;
  /** The row's own choices; absent ⇒ Accept / Adjust. */
  options?: GateOption[];
  /** Status page only: the stored URL to probe before the gate asks. */
  probe_needed?: { url: string };
};

export type GateQuestion = { row: LaunchRowKey; header: string; question: string; multiSelect: false; options: GateOption[] };
export type GateCard = { questions: GateQuestion[] };

/** `status-artifact.json`'s `last_probe`. */
export type ProbeRecord = { at: string; ok: boolean; url: string; reason?: string };
export type StatusArtifact = { url?: string; kind?: string; template_version?: number; last_probe?: ProbeRecord };

export type StatusPageInput = {
  /** `status_page.enabled` (default true). */
  enabled: boolean;
  /** Whether this host publishes the page as an artifact. */
  publishExpected: boolean;
  /** `status-artifact.json`, or null when absent. */
  artifact: StatusArtifact | null;
  /** The shipped template's `bh-template-version`, or null when unreadable. */
  templateVersion: number | null;
  nowIso: string;
};

export type LaunchSummaryInput = {
  report: StatusReport;
  config: ConfigSummaryInput & Record<string, unknown>;
  budget: BudgetView;
  statusPage: StatusPageInput;
};

const ACCEPT: GateOption = { label: 'Accept', description: 'Keep this section as shown.' };
const REUSE: GateOption = { label: 'Reuse another', description: 'Pick an existing artifact from Artifact list and store its URL.' };
const PUBLISH: GateOption = { label: 'Publish new', description: 'Publish a new status page and store its URL.' };
const REFRESH: GateOption = { label: 'Refresh template', description: 'Rewrite the page with the current template, keeping hand edits.' };

const ADJUST: Partial<Record<LaunchRowKey, string>> = {
  scope: 'Open step 1: the scope filter and the targeted-issues preview.',
  merge: 'Open step 2, then step 3 when the answer is gated batch.',
  budget: 'Open step 4 (parallel_max); usage_budget thresholds are edited in config.json.',
  status_page: 'Turn the status page on or off in config.json.',
  kaizen_staging: 'Open step 5: the kaizen block.',
};

const MERGE_MODES: GateOption[] = [
  { label: 'Immediate', description: 'Merge each PR as it reaches LGTM.' },
  { label: 'Gated batch', description: 'Wait for every in-scope PR to reach LGTM, then merge in dependency order.' },
  { label: 'Leave open', description: 'Drive every PR to LGTM and leave it open for you to merge.' },
];

/** Epoch seconds as `YYYY-MM-DD HH:MMZ`. */
export const formatEpoch = (s: number): string => `${new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z`;
const pct = (x: number): string => `${Number(x.toFixed(1))}%`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function scopeRow(report: StatusReport, config: ConfigSummaryInput & { repo?: string }): LaunchRow {
  const q = report.counts.queue;
  const forge = report.forge.ok ? `${report.forge.openIssues} open issues / ${report.forge.openPrs} open PRs` : 'forge not read';
  return {
    key: 'scope',
    label: 'Scope',
    header: 'Scope',
    value: `${config.repo ?? 'no repo'} · ${formatScopeLabel(readScope(config))} · ${q.ready} ready / ${q.blocked} blocked / ${q.in_flight} in flight · ${forge}`,
    consequence: 'The campaign works only these issues; anything outside the filter is left alone.',
    adjustable: true,
  };
}

const orderRow = (): LaunchRow => ({
  key: 'order',
  label: 'Order',
  header: 'Order',
  value: 'bugs first, then Pareto priority · stacking on',
  consequence: 'Bugs land before features; a PR that overlaps another stacks on it instead of waiting.',
  adjustable: false,
});

const MERGE: Record<string, { who: string; consequence: string }> = {
  immediate: { who: 'blackhole merges', consequence: 'Each PR merges as soon as it reaches LGTM with CI green.' },
  'gated-batch': { who: 'blackhole merges', consequence: 'PRs wait until every in-scope PR reaches LGTM, then merge in dependency order.' },
  'leave-open': { who: 'you merge', consequence: 'Every PR is driven to LGTM and left open for you to review and merge.' },
};

function mergeRow(mode: string | undefined): LaunchRow {
  const base = { key: 'merge' as const, label: 'Merge', header: 'Merge', adjustable: true };
  const known = mode ? MERGE[mode] : undefined;
  if (known) return { ...base, value: `${mode} · ${known.who}`, consequence: known.consequence };
  return {
    ...base,
    value: mode ? `${mode} (unknown)` : 'unset',
    consequence: 'No valid merge mode is set: one must be picked before the campaign can start (R-002).',
    options: MERGE_MODES,
  };
}

function budgetConsequence(b: BudgetView): string {
  const t = b.thresholds;
  switch (b.verdict) {
    case 'off':
      return `Usage pacing is off: up to ${plural(b.parallel_max, 'worker')} run whatever the usage.`;
    case 'GO':
      return `${plural(b.workers, 'worker')} ${b.workers === 1 ? 'starts' : 'start'} now; spawning stops at 5h ${t.no_spawn_at}%, the campaign at weekly ${t.stop_campaign_at}%.`;
    case 'NO-SPAWN':
      return 'No new worker spawns until the 5-hour window resets; in-flight workers finish.';
    case 'STOP-WORKERS':
      return `Workers stop now; the campaign waits for the 5-hour reset at ${b.wake_at === null ? 'an unknown time' : formatEpoch(b.wake_at)}.`;
    case 'NO-NEW-STARTS':
      return 'No new chain starts this week; in-flight chains finish.';
    case 'STOP-CAMPAIGN':
      return `The campaign drains and stops: weekly usage is at or past ${t.stop_campaign_at}%.`;
    case 'PACE-WAIT':
      return `The campaign waits until ${b.wake_at === null ? 'the weekly reset' : formatEpoch(b.wake_at)} to land on the weekly target.`;
    default:
      return b.probed
        ? `Usage could not be read: workers are sized from parallel_max (${b.parallel_max}).`
        : `Usage not probed: workers are sized from parallel_max (${b.parallel_max}).`;
  }
}

export function budgetRow(b: BudgetView): LaunchRow {
  const t = b.thresholds;
  const window = (name: string, w: BudgetView['five_hour']): string => (w ? `${name} ${pct(w.used_percentage)} (resets ${formatEpoch(w.resets_at)})` : `${name} n/a`);
  const usage = b.probed ? [window('5h', b.five_hour), window('weekly', b.weekly)] : ['not probed'];
  const head = !b.enabled ? 'pacing off' : b.verdict === 'unavailable' ? (b.probed ? 'usage unavailable' : '') : b.verdict;
  const workers = b.verdict === 'off' || b.verdict === 'unavailable' ? `${plural(b.workers, 'worker')} (parallel_max)` : `${plural(b.workers, 'worker')} allowed`;
  const forecast = !b.enabled
    ? []
    : b.forecast?.pct_per_hour == null
      ? ['no forecast yet']
      : [
          `forecast ${pct(b.forecast.pct_per_hour)}/h, weekly stop ${
            b.forecast.reaches_at_pct.stop_campaign_at === null ? 'not reached' : formatEpoch(b.forecast.reaches_at_pct.stop_campaign_at)
          }`,
        ];
  const parts = [
    head,
    ...usage,
    workers,
    `stops 5h ${t.no_spawn_at}/${t.stop_workers_at}%, weekly ${t.no_new_starts_at}/${t.stop_campaign_at}%`,
    ...(t.target_at_reset === null ? [] : [`target ${t.target_at_reset}% at weekly reset`]),
    ...forecast,
  ].filter(Boolean);
  return { key: 'budget', label: 'Budget', header: 'Budget', value: parts.join(' · '), consequence: budgetConsequence(b), adjustable: true };
}

export function statusPageRow(p: StatusPageInput): LaunchRow {
  const base = { key: 'status_page' as const, label: 'Status page', header: 'Status page', adjustable: true };
  if (!p.enabled) {
    return { ...base, value: 'off (status_page.enabled is false)', consequence: 'No page is published; follow the run with bun run status.' };
  }
  if (!p.publishExpected) {
    return { ...base, adjustable: false, value: 'none on this host', consequence: 'This host has no artifact tool; follow the run with bun run status.' };
  }
  if (!p.artifact?.url) {
    return { ...base, value: 'never published', consequence: 'A new page is published before the first spawn.', options: [{ ...ACCEPT, description: 'Publish a new page before the first spawn.' }, REUSE] };
  }
  const { url, template_version: stored, last_probe: probe } = p.artifact;
  const staleTemplate = p.templateVersion !== null && typeof stored === 'number' && stored < p.templateVersion;
  const template = typeof stored === 'number' ? `template v${stored}${staleTemplate ? `, refresh template to v${p.templateVersion}` : ''}` : 'template unknown';
  const ageMin = probe ? (Date.parse(p.nowIso) - Date.parse(probe.at)) / 60_000 : NaN;
  const current = probe !== undefined && probe.url === url && ageMin >= 0 && ageMin < PROBE_FRESH_MINUTES;
  const extra = staleTemplate ? [REFRESH] : [];
  if (current && !probe.ok) {
    return {
      ...base,
      value: `${url} · NOT reachable: ${probe.reason ?? 'no reason recorded'} · ${template}`,
      consequence: 'The stored page does not open from this account: reuse another artifact or publish a new one.',
      options: [REUSE, PUBLISH],
    };
  }
  if (current) {
    return {
      ...base,
      value: `${url} · reachable (probed ${Math.floor(ageMin)} min ago) · ${template}`,
      consequence: 'The stored page opens from this account and is refreshed at every checkpoint.',
      options: [{ ...ACCEPT, description: 'Keep refreshing the stored page.' }, REUSE, PUBLISH, ...extra],
    };
  }
  return {
    ...base,
    value: `${url} · not probed · ${template}`,
    consequence: 'Probe the stored page (ArtifactData list of datasets) and re-run the summary before the first spawn.',
    options: [{ ...ACCEPT, description: 'Keep the stored page once the probe passes.' }, REUSE, PUBLISH, ...extra],
    probe_needed: { url },
  };
}

const TRIGGERS: Record<string, string> = { 'on-empty': 'when the queue empties', manual: 'only on request' };

function kaizenRow(config: ConfigSummaryInput & { kaizen?: { trigger?: string; loop_interval?: number } }): LaunchRow {
  const kz = config.kaizen?.enabled === true;
  const trigger = config.kaizen?.trigger ?? 'on-empty';
  const staging = config.docs_governance?.enabled === true && config.docs_governance.write_governance !== false;
  const when = TRIGGERS[trigger] ?? `every ${config.kaizen?.loop_interval ?? 5} loops`;
  return {
    key: 'kaizen_staging',
    label: 'Kaizen and staging',
    header: 'Kaizen',
    value: `kaizen ${kz ? `on (trigger ${trigger})` : 'off'} · staging carry ${staging ? 'on' : 'off'}`,
    consequence: `${kz ? `Improvement hunts file issues ${when}` : 'No improvement hunts run'}; ${staging ? 'staged docs carry into each PR' : 'no staged docs are carried'}.`,
    adjustable: true,
  };
}

function peersRow(config: Record<string, unknown>): LaunchRow {
  const { role, manager_session, peer_floor } = resolveUsageBudget(config).coordination;
  const base = { key: 'peers' as const, label: 'Peers', header: 'Peers', adjustable: false };
  if (role === 'manager') return { ...base, value: 'manager', consequence: 'This session grants worker slots to the peer sessions sharing its usage budget.' };
  if (role === 'peer') {
    return { ...base, value: `peer of ${manager_session}`, consequence: `Beyond ${plural(peer_floor, 'worker')}, this session waits for slots granted by ${manager_session}.` };
  }
  return { ...base, value: 'solo', consequence: 'This session spends the usage budget alone; no other session is coordinated.' };
}

/** The seven rows, in `LAUNCH_ROW_KEYS` order. */
export function buildLaunchSummary({ report, config, budget, statusPage }: LaunchSummaryInput): LaunchRow[] {
  return [scopeRow(report, config), orderRow(), mergeRow(config.merge_mode), budgetRow(budget), statusPageRow(statusPage), kaizenRow(config), peersRow(config)];
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The summary as one markdown table, the text the launch gate prints verbatim. */
export function renderLaunchSummary(rows: LaunchRow[]): string {
  return [
    '## Launch summary',
    '',
    '| Section | Now | Consequence |',
    '|---------|-----|-------------|',
    ...rows.map((r) => `| ${r.label} | ${cell(r.value)} | ${cell(r.consequence)} |`),
    '',
  ].join('\n');
}

/** One question per adjustable row, `QUESTIONS_PER_CARD` per card. Print-only mode asks nothing. */
export function gateCards(rows: LaunchRow[], { printOnly }: { printOnly: boolean }): GateCard[] {
  if (printOnly) return [];
  const questions: GateQuestion[] = rows
    .filter((r) => r.adjustable)
    .map((r) => ({
      row: r.key,
      header: r.header,
      question: `${r.label}: ${r.consequence}`,
      multiSelect: false,
      options: r.options ?? [ACCEPT, { label: 'Adjust', description: ADJUST[r.key] ?? 'Change this section.' }],
    }));
  const cards: GateCard[] = [];
  for (let i = 0; i < questions.length; i += QUESTIONS_PER_CARD) cards.push({ questions: questions.slice(i, i + QUESTIONS_PER_CARD) });
  return cards;
}
