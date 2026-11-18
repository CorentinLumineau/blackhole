import { readScope } from '../../forge-scope.ts';
import { adjustPacing, type CatchupConfig, type Pacing } from '../catchup.ts';
import { joinTarget, type DetectedPeer, type DetectResult } from '../peer-campaigns.ts';
import { DEFAULT_USAGE_BUDGET, type UsageBudgetConfig } from '../usage-budget.ts';
import { parallelMaxOf, resolveBudgetSettings, when } from './budget.ts';
import { formatScopeLabel } from './dashboard.ts';
import { isSleepMode, QUESTIONS_PER_CARD } from './pending-decisions.ts';
import { readSleepSession } from './sleep-session.ts';
import { statusPageRow, type StatusPageInput } from './status-page-row.ts';
import { CATCHUP_ROW_KEYS, LAUNCH_ROW_KEYS, type BudgetPanel, type ConfigSummaryInput, type GateOption, type LaunchRow, type LaunchRowKey, type StatusReport } from './types.ts';

// The executive-summary launch gate: one row per section, each with a one-line consequence, and
// the Accept / Adjust question cards built from those rows. Pure: every input is already read;
// `scripts/campaign-status.ts --summary` does the I/O. The Budget row reads the status page's own
// `BudgetPanel` (`budget.ts`), so the gate and the page never disagree.

// Re-exported: callers import the row keys and row types from here.
export { CATCHUP_ROW_KEYS, LAUNCH_ROW_KEYS };
export type { GateOption, LaunchRow, LaunchRowKey };

/** A consequence must read on its own on a card line. */
export const MAX_CONSEQUENCE_CHARS = 140;

export type GateQuestion = { row: LaunchRowKey; header: string; question: string; multiSelect: false; options: GateOption[] };
export type GateCard = { questions: GateQuestion[] };

export type LaunchSummaryInput = {
  report: StatusReport;
  config: ConfigSummaryInput & Record<string, unknown>;
  budget: BudgetPanel;
  statusPage: StatusPageInput;
  /** Present for `catchup` mode: nine rows with Pacing and the floor budget; absent: the eight run rows. */
  catchup?: CatchupInput;
  /** `scripts/peer-campaigns.ts detect`; absent when detection did not run (no git clone): the row shows the configured role only. */
  peers?: DetectResult;
};

/** The catchup launch inputs (ADR-054 C2): the effective preset after the invocation's overrides, the
 * effective floor (null when usage is unreadable), the pace reading and the floor budget the Budget
 * row judges by; or the invalid-block message, shown on the Pacing row instead of a throw. */
export type CatchupInput = { invalid: string } | { preset: CatchupConfig; floorPct: number | null; pacing: Pacing; budget: UsageBudgetConfig };

const ACCEPT: GateOption = { label: 'Accept', description: 'Keep this section as shown.' };

const ADJUST: Partial<Record<LaunchRowKey, string>> = {
  scope: 'Open step 1: the scope filter and the targeted-issues preview.',
  merge: 'Open step 2, then step 3 when the answer is gated batch.',
  budget: 'Open step 4 (parallel_max); usage_budget thresholds are edited in config.json.',
  status_page: 'Turn the status page on or off in config.json.',
  kaizen_staging: 'Open step 5: the kaizen block.',
  pacing: 'Change the floor, the 5h caps or the lane for this invocation only; config.json is untouched.',
};

const MERGE_MODES: GateOption[] = [
  { label: 'Immediate', description: 'Merge each PR as it reaches LGTM.' },
  { label: 'Gated batch', description: 'Wait for every in-scope PR to reach LGTM, then merge in dependency order.' },
  { label: 'Leave open', description: 'Drive every PR to LGTM and leave it open for you to merge.' },
];

const pct = (x: number): string => `${Number(x.toFixed(2))}%`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The `usage_budget` the rows show: the resolved one, or the defaults when it is invalid (then `invalid` says why). */
function rowSettings(config: Record<string, unknown>): { settings: UsageBudgetConfig; invalid: string | null } {
  const r = resolveBudgetSettings(config);
  return r.invalid === null ? { settings: r.budget, invalid: null } : { settings: DEFAULT_USAGE_BUDGET, invalid: r.invalid };
}

function scopeRow(report: StatusReport, config: ConfigSummaryInput & { repo?: string }): LaunchRow {
  const q = report.counts.queue;
  const forge = report.forge.ok ? `${report.forge.openIssues} open issues / ${report.forge.openPrs} open PRs` : 'forge not read';
  return {
    key: 'scope',
    label: 'Scope',
    header: 'Scope',
    value: `${config.repo ?? 'no repo'} · ${formatScopeLabel(readScope(config), 'markdown')} · ${q.ready} ready / ${q.blocked} blocked / ${q.in_flight} in flight · ${forge}`,
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

type BudgetState = { b: BudgetPanel; settings: UsageBudgetConfig; invalid: string | null; workers: number; parallelMax: number; catchup: boolean };

function budgetConsequence({ b, settings, invalid, workers, parallelMax, catchup }: BudgetState): string {
  if (catchup && (!b.probed || b.verdict === 'unavailable' || b.verdict === null || b.weekly_pct === null)) return 'Usage unreadable: the catchup skips and spawns nothing (fail-closed).';
  if (invalid) return `usage_budget is invalid, so pacing is unavailable: workers are sized from parallel_max (${parallelMax}).`;
  if (!settings.enabled) return `Usage pacing is off: up to ${plural(parallelMax, 'worker')} run whatever the usage.`;
  if (!b.probed) return `Usage not probed: workers are sized from parallel_max (${parallelMax}).`;
  const t = { ...settings.five_hour, ...settings.weekly };
  switch (b.verdict) {
    case 'GO': {
      const starts = `${plural(workers, 'worker')} ${workers === 1 ? 'starts' : 'start'} now`;
      return weeklyOnly(b, settings)
        ? `${starts}; the campaign stops at weekly ${t.stop_campaign_at}%.`
        : `${starts}; spawning stops at 5h ${t.no_spawn_at}%, the campaign at weekly ${t.stop_campaign_at}%.`;
    }
    case 'NO-SPAWN':
      return 'No new worker spawns until the 5-hour window resets; in-flight workers finish.';
    case 'STOP-WORKERS':
      return `Workers stop now; the campaign waits for the 5-hour reset at ${b.five_hour_resets_at ? when(b.five_hour_resets_at) : 'an unknown time'}.`;
    case 'NO-NEW-STARTS':
      return 'No new chain starts this week; in-flight chains finish.';
    case 'STOP-CAMPAIGN':
      return `The campaign drains and stops: weekly usage is at or past ${t.stop_campaign_at}%.`;
    case 'PACE-WAIT':
      return 'The campaign waits until a worker fits the pace that lands on the weekly target at the reset.';
    default:
      return `Usage could not be read: workers are sized from parallel_max (${parallelMax}).`;
  }
}

/** The weekly window and no 5-hour one: the reading's windows, or before any reading the configured `usage_budget.windows`. */
const weeklyOnly = (b: BudgetPanel, settings: UsageBudgetConfig): boolean => {
  const windows = b.probed ? b.windows : (settings.windows ?? []);
  return windows.includes('seven_day') && !windows.includes('five_hour');
};

function forecastText(b: BudgetPanel, stopAt: number): string {
  if (!b.forecast) return 'no forecast yet';
  if (b.forecast.pct_per_hour === null) return 'no weekly trend yet';
  const stop = b.forecast.reaches.find((r) => r.pct === stopAt);
  return `forecast ${pct(b.forecast.pct_per_hour)}/h, weekly stop ${stop?.at ? when(stop.at) : 'not before the reset'}`;
}

/** The Budget row, from the status page's panel plus the thresholds `config.json` sets. */
export function budgetRow(b: BudgetPanel, config: Record<string, unknown>, floorBudget?: UsageBudgetConfig): LaunchRow {
  const catchup = floorBudget !== undefined;
  const { settings, invalid } = floorBudget ? { settings: floorBudget, invalid: null } : rowSettings(config);
  const parallelMax = parallelMaxOf(config);
  const weekly = weeklyOnly(b, settings);
  const sized = invalid !== null || !settings.enabled || !b.probed || b.verdict === 'unavailable' || b.workers_allowed === null;
  const workers = sized ? parallelMax : (b.workers_allowed as number);
  const head = invalid ? 'usage_budget invalid, unavailable' : !settings.enabled ? 'pacing off' : b.probed ? (b.verdict ?? 'unavailable') : '';
  const usage = b.probed
    ? [
        ...(weekly ? [] : [b.five_hour_pct === null ? '5h n/a' : `5h ${pct(b.five_hour_pct)}${b.five_hour_resets_at ? ` (resets ${when(b.five_hour_resets_at)})` : ''}`]),
        b.weekly_pct === null ? 'weekly n/a' : `weekly ${pct(b.weekly_pct)}${b.resets_at ? ` (resets ${when(b.resets_at)})` : ''}`,
      ]
    : [b.reason ? `not probed: ${b.reason}` : 'not probed'];
  const { no_spawn_at, stop_workers_at } = settings.five_hour;
  const { no_new_starts_at, stop_campaign_at, target_at_reset } = settings.weekly;
  // A catchup's two weekly lines are the one floor.
  const weeklyLines = catchup ? `${stop_campaign_at}%` : `${no_new_starts_at}/${stop_campaign_at}%`;
  const parts = [
    head,
    ...usage,
    sized ? `${plural(workers, 'worker')} (parallel_max)` : `${plural(workers, 'worker')} allowed`,
    weekly ? `stops weekly ${weeklyLines}` : `stops 5h ${no_spawn_at}/${stop_workers_at}%, weekly ${weeklyLines}`,
    ...(target_at_reset === null ? [] : [`target ${target_at_reset}% at weekly reset`]),
    ...(b.probed ? [forecastText(b, stop_campaign_at)] : []),
  ].filter(Boolean);
  const consequence = budgetConsequence({ b, settings, invalid, workers, parallelMax, catchup });
  return { key: 'budget', label: 'Budget', header: 'Budget', value: parts.join(' · '), consequence, adjustable: true };
}

const PACING_BASE = { key: 'pacing' as const, label: 'Pacing', header: 'Pacing', adjustable: true };

/** The Pacing row of a catchup (ADR-054 C2): the reading, the floor, the shortfall, the 5h caps and the lane. */
export function pacingRow(input: CatchupInput): LaunchRow {
  if ('invalid' in input) {
    return { ...PACING_BASE, value: `catchup config invalid: ${input.invalid}`, consequence: 'catchup config is invalid, so the catchup cannot start.' };
  }
  const { preset, floorPct } = input;
  const pacing = adjustPacing(input.pacing, floorPct);
  const tail = `5h caps ${preset.five_hour.no_spawn_at}/${preset.five_hour.stop_workers_at} · lane ${preset.lane ?? 'unset'}`;
  if (pacing.status !== 'ok' || floorPct === null || pacing.used_pct === null || pacing.shortfall_pct === null) {
    const why = pacing.status === 'unreadable' ? 'usage unreadable' : 'no weekly window';
    return {
      ...PACING_BASE,
      value: `plan ${pacing.plan} · ${why}${pacing.reason ? ` (${pacing.reason})` : ''} · ${tail}`,
      consequence: `${pacing.status === 'unreadable' ? 'Usage is unreadable' : 'The reading has no weekly window'}: the catchup skips (fail-closed).`,
    };
  }
  const shortfall = pacing.shortfall_pct;
  const floorText = floorPct === input.pacing.floor_pct ? `floor ${pct(floorPct)} (${input.pacing.credits} credits x ${preset.pct_per_weekday})` : `floor ${pct(floorPct)} (adjusted)`;
  const value = [
    `plan ${pacing.plan}`,
    `weekly ${pct(pacing.used_pct)}${pacing.resets_at ? ` (resets ${when(new Date(pacing.resets_at * 1000).toISOString())})` : ''}`,
    floorText,
    `shortfall ${pct(shortfall)}`,
    tail,
  ].join(' · ');
  const consequence =
    shortfall > 0
      ? `Spends about ${Number(shortfall.toFixed(2))} points of weekly quota on backlog work and stops at ${pct(floorPct)}; 5h spawns stop at ${preset.five_hour.no_spawn_at}%, workers at ${preset.five_hour.stop_workers_at}%.`
      : 'Usage is at or above the floor: the catchup exits without spawning.';
  return { ...PACING_BASE, value, consequence };
}

const TRIGGERS: Record<string, string> = { 'on-empty': 'when the queue empties', manual: 'only on request' };

function kaizenRow(config: ConfigSummaryInput & { kaizen?: { trigger?: string; loop_interval?: number } }): LaunchRow {
  const kz = config.kaizen?.enabled === true;
  const trigger = config.kaizen?.trigger ?? 'on-empty';
  const staging = config.docs_governance?.enabled === true && config.docs_governance.write_governance !== false;
  const cadence = TRIGGERS[trigger] ?? `every ${config.kaizen?.loop_interval ?? 5} loops`;
  return {
    key: 'kaizen_staging',
    label: 'Kaizen and staging',
    header: 'Kaizen',
    value: `kaizen ${kz ? `on (trigger ${trigger})` : 'off'} · staging carry ${staging ? 'on' : 'off'}`,
    consequence: `${kz ? `Improvement hunts file issues ${cadence}` : 'No improvement hunts run'}; ${staging ? 'staged docs carry into each PR' : 'no staged docs are carried'}.`,
    adjustable: true,
  };
}

const PEER_STOP: GateOption = { label: 'Stop', description: 'End this bootstrap and release this session; the other campaign keeps the clone.' };
const PEER_TAKE_OVER: GateOption = {
  label: 'Take over after drain',
  description: 'Spawn nothing now; re-run detect on each resume and start once no live peer remains.',
};
const peerJoin = (hostSession: string): GateOption => ({
  label: 'Join as peer',
  description: `Write usage_budget.coordination role peer, manager_session ${hostSession}, and share its usage budget.`,
});
const peerName = (p: DetectedPeer): string => p.worktree.split('/').filter(Boolean).pop() ?? p.worktree;

/** The configured coordination role, before peer detection. */
function rolePeersRow(config: Record<string, unknown>): LaunchRow {
  const { role, manager_session, peer_floor } = rowSettings(config).settings.coordination;
  const base = { key: 'peers' as const, label: 'Peers', header: 'Peers', adjustable: false };
  if (role === 'manager') return { ...base, value: 'manager', consequence: 'This session grants worker slots to the peer sessions sharing its usage budget.' };
  if (role === 'peer') {
    return { ...base, value: `peer of ${manager_session}`, consequence: `Beyond ${plural(peer_floor, 'worker')}, this session waits for slots granted by ${manager_session}.` };
  }
  return { ...base, value: 'solo', consequence: 'This session spends the usage budget alone; no other session is coordinated.' };
}

/**
 * Peers (ADR-057). A live peer not yet coordinated with this session turns the row into the gate's
 * stop / join / take-over question; a coordinated peer (it names this session as manager, or it is
 * the manager this session joined) never asks again. A clean detection says its reach.
 */
function peersRow(config: Record<string, unknown>, detected: DetectResult | undefined): LaunchRow {
  const row = rolePeersRow(config);
  if (!detected) return row;
  const open = detected.peers.filter((p) => !p.coordinated);
  const { unreadable } = detected;
  if (open.length || unreadable) {
    const join = open.length ? joinTarget(detected.peers) : null;
    const list = open.map((p) => `${peerName(p)} (turn ${p.turn}, heartbeat ${p.heartbeat_age_minutes}m ago)`).join(', ');
    const unread = plural(unreadable, 'unreadable record');
    const value = !open.length ? `unknown (${unread})` : `${plural(open.length, 'live peer')} in this clone: ${list}${unreadable ? `; ${unread}` : ''}`;
    return {
      ...row,
      value,
      consequence: open.length
        ? 'Another campaign runs in this clone: stop, join it, or take over after it drains; this session never starts as solo.'
        : 'Unreadable peer records may be a live campaign: stop, or take over once they clear; never starts as solo.',
      adjustable: true,
      options: join ? [PEER_STOP, peerJoin(join), PEER_TAKE_OVER] : [PEER_STOP, PEER_TAKE_OVER],
    };
  }
  const naming = detected.peers.filter((p) => p.names_me);
  if (naming.length && rowSettings(config).settings.coordination.role === 'solo') {
    return {
      ...row,
      value: `manager of ${plural(naming.length, 'live peer')} in this clone: ${naming.map(peerName).join(', ')}`,
      consequence: 'A live peer runs as peer of this session, so it acts as manager and grants worker slots from its usage budget.',
    };
  }
  return detected.peers.length ? row : { ...row, value: `${row.value} (no live peer in this clone)` };
}

/** Sleep mode (`sleep-mode.md`): display-only, since the gate itself is print-only while it is on. */
export function sleepRow(config: Record<string, unknown>): LaunchRow {
  const base = { key: 'sleep' as const, label: 'Sleep mode', header: 'Sleep', adjustable: false };
  if (!isSleepMode(config)) {
    return { ...base, value: 'off', consequence: 'Every gate asks as it comes; `/blackhole sleep` parks owner questions for one wake-up round.' };
  }
  const { since } = readSleepSession(config);
  return {
    ...base,
    value: since ? `on since ${when(since)}` : 'on',
    consequence: 'No question is asked: each is parked for the wake-up round, and this gate only prints.',
  };
}

/** The eight run rows in `LAUNCH_ROW_KEYS` order; with `catchup`, the nine rows in `CATCHUP_ROW_KEYS` order. */
export function buildLaunchSummary({ report, config, budget, statusPage, catchup, peers }: LaunchSummaryInput): LaunchRow[] {
  const floorBudget = catchup && !('invalid' in catchup) ? catchup.budget : undefined;
  const rows = [
    scopeRow(report, config), orderRow(), mergeRow(config.merge_mode), budgetRow(budget, config, floorBudget),
    statusPageRow(statusPage), kaizenRow(config), peersRow(config, peers), sleepRow(config),
  ];
  if (!catchup) return rows;
  rows.splice(3, 0, pacingRow(catchup));
  return rows;
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The summary as one markdown table, the text the launch gate prints verbatim; each warning is a `> ` line above it. */
export function renderLaunchSummary(rows: LaunchRow[], warnings: string[] = []): string {
  return [
    '## Launch summary',
    '',
    ...(warnings.length ? [...warnings.map((w) => `> ${w}`), ''] : []),
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
