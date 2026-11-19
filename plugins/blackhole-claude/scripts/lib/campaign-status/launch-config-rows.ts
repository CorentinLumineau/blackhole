import { DEFAULT_PACE_GATE, resolvePaceGateThresholds, type PaceGateThresholds } from '../pace-gate.ts';
import { DEFAULT_RESOURCE_GATE, resolveResourceGateThresholds, type ResourceGateThresholds } from '../resource-gate.ts';
import { resolveBudgetSettings } from './budget.ts';
import type { BudgetPanel, LaunchRow, LaunchRowKey } from './types.ts';

// The launch summary's config rows: Pacing (run form), Autonomy, Resource policy, Wave scheduling and
// the Other config catch-all. Pure: each builder takes the config and the budget panel already read.

/**
 * A row's claim on `config.json`: a whole block (a string) or only the listed depth-1 keys of a block.
 * A whole-block claim is allowed only when the row's value reads the whole block, and is exclusive.
 * A row that reads a block partly claims exactly the keys its value reads; the block's other keys
 * fall through to Other config, so no key reaches a run unseen. Two rows may claim disjoint key sets
 * of one block.
 */
export type RowClaim = string | { block: string; keys: readonly string[] };

export const LAUNCH_ROW_CLAIMS: Record<LaunchRowKey, readonly RowClaim[]> = {
  scope: ['repo', 'scope_milestone', 'scope_labels'],
  order: [],
  merge: ['merge_mode'],
  pacing: [{ block: 'usage_budget', keys: ['enabled', 'five_hour', 'weekly', 'windows', 'max_workers'] }, 'catchup'],
  budget: ['parallel_max'],
  status_page: ['status_page'],
  kaizen_staging: [
    { block: 'kaizen', keys: ['enabled', 'trigger', 'loop_interval'] },
    { block: 'docs_governance', keys: ['enabled', 'write_governance'] },
  ],
  autonomy: [{ block: 'autonomy', keys: ['mode', 'confidence_threshold', 'design_autonomy', 'never_bypass'] }],
  resource_policy: [{ block: 'resource_policy', keys: ['fan_out_override', 'mitigations', 'testlock_carveout', 'gate', 'pace'] }],
  wave_scheduling: [{ block: 'wave_scheduling', keys: ['shard_by_touch_path', 'hot_files_max_one_per_wave', 'batched_checks_pr'] }],
  peers: [{ block: 'usage_budget', keys: ['coordination'] }],
  sleep: ['sleep_mode'],
  other_config: [],
};

/** Each row's `label`: the text the table shows and the `Launch summary` declarations name. */
export const LAUNCH_ROW_LABELS: Record<LaunchRowKey, string> = {
  scope: 'Scope',
  order: 'Order',
  merge: 'Merge',
  pacing: 'Pacing',
  budget: 'Budget',
  status_page: 'Status page',
  kaizen_staging: 'Kaizen and staging',
  autonomy: 'Autonomy',
  resource_policy: 'Resource policy',
  wave_scheduling: 'Wave scheduling',
  peers: 'Peers',
  sleep: 'Sleep mode',
  other_config: 'Other config',
};

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const DEFAULT_CONFIDENCE_THRESHOLD = 80;
const DEFAULT_NEVER_BYPASS = 3;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sub = (config: Obj, block: string): Obj => (isObj(config[block]) ? (config[block] as Obj) : {});
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const absent = (config: Obj, block: string): boolean => !Object.hasOwn(config, block);

const row = (key: LaunchRowKey, header: string, value: string, consequence: string): LaunchRow => ({
  key,
  label: LAUNCH_ROW_LABELS[key],
  header,
  value,
  consequence,
  adjustable: false,
});

// A bad threshold is reported by the resolvers' own error where it matters; a display row shows the defaults.
function paceGate(config: Obj): PaceGateThresholds {
  try {
    return resolvePaceGateThresholds(config);
  } catch {
    return DEFAULT_PACE_GATE;
  }
}
function resourceGate(config: Obj): ResourceGateThresholds {
  try {
    return resolveResourceGateThresholds(config);
  } catch {
    return DEFAULT_RESOURCE_GATE;
  }
}

const ageText = (seconds: number): string => (seconds < 90 ? `${Math.round(seconds)} s old` : `${Math.round(seconds / 60)} min old`);

const readingText = (b: BudgetPanel): string =>
  b.probed ? `reading source ${b.source ?? 'none'}${b.age_seconds === null ? '' : `, ${ageText(b.age_seconds)}`}` : `no reading (${b.reason ?? 'unknown'})`;

/** The Pacing row of a run: whether pacing is off, absent or on, its thresholds, the pace gate and where the reading came from. Display-only. */
export function runPacingRow(config: Obj, budget: BudgetPanel): LaunchRow {
  const maxAge = paceGate(config).maxAgeSeconds;
  const catchup = Object.hasOwn(config, 'catchup') ? 'catchup preset set' : 'no catchup preset';
  const tail = [`pace gate max age ${maxAge} s`, readingText(budget), catchup];
  const resolved = resolveBudgetSettings(config);
  const make = (state: string, consequence: string, ...detail: string[]): LaunchRow =>
    row('pacing', 'Pacing', [state, ...detail, ...tail].join(' · '), consequence);
  if (resolved.invalid !== null) return make('usage_budget invalid', 'usage_budget is invalid and ignored: workers run up to parallel_max whatever the usage.');
  const s = resolved.budget;
  if (absent(config, 'usage_budget')) return make('usage_budget absent', 'Pacing is off by default: no usage limit applies, workers run up to parallel_max.');
  if (!s.enabled) return make('usage_budget disabled', 'Pacing is switched off: no usage limit applies, workers run up to parallel_max.');
  return make(
    'usage_budget enabled',
    `Spawns stop at 5h ${s.five_hour.no_spawn_at}%, the campaign at weekly ${s.weekly.stop_campaign_at}%; a reading older than ${maxAge} s is not trusted.`,
    `5h ${s.five_hour.no_spawn_at}/${s.five_hour.stop_workers_at}%`,
    `weekly ${s.weekly.no_new_starts_at}/${s.weekly.stop_campaign_at}%`,
    `windows ${s.windows === null ? 'all' : s.windows.join('+')}`,
    `max ${plural(s.max_workers, 'worker')}`,
  );
}

/** The Autonomy row: the grant mode and the thresholds a route must clear to proceed without asking. Display-only. */
export function autonomyRow(config: Obj): LaunchRow {
  const a = sub(config, 'autonomy');
  const mode = typeof a.mode === 'string' ? a.mode : null;
  const threshold = typeof a.confidence_threshold === 'number' ? a.confidence_threshold : DEFAULT_CONFIDENCE_THRESHOLD;
  const design = a.design_autonomy !== false;
  const bypass = Array.isArray(a.never_bypass) ? a.never_bypass.length : DEFAULT_NEVER_BYPASS;
  const value = [`mode ${mode ?? 'unset'}`, `confidence threshold ${threshold}`, `design autonomy ${design ? 'on' : 'off'}`, `${plural(bypass, 'never-bypass trigger')}`].join(' · ');
  const consequence =
    mode === 'full'
      ? 'Design approvals, split sign-offs, plan waivers and BLOCK remedies are decided without asking you.'
      : `Decisions proceed alone at confidence ${threshold} or more; ${plural(bypass, 'trigger')} always ask you.`;
  return row('autonomy', 'Autonomy', value, consequence);
}

/** The Resource policy row: the fan-out override, mitigations, test-lock carve-out and the two gate thresholds. Names presence and counts, never the free text. Display-only. */
export function resourcePolicyRow(config: Obj): LaunchRow {
  const gate = resourceGate(config);
  if (absent(config, 'resource_policy')) {
    return row('resource_policy', 'Resources', 'absent: defaults', `The resource gate defers a batch below ${gate.deferBelowMemMb} MB free memory; the test-lock wrapper is mandatory.`);
  }
  const p = sub(config, 'resource_policy');
  const override = typeof p.fan_out_override === 'string' && p.fan_out_override !== '';
  const carve = sub(p, 'testlock_carveout');
  const carveOn = carve.allowed === true;
  const value = [
    override ? 'fan-out override set' : 'no fan-out override',
    plural(count(p.mitigations), 'mitigation'),
    carveOn ? `test-lock carve-out on (${plural(count(carve.conditions), 'condition')})` : 'test-lock carve-out off',
    `gate defers below ${gate.deferBelowMemMb} MB`,
    `pace max age ${paceGate(config).maxAgeSeconds} s`,
  ].join(' · ');
  const consequence = override
    ? `Fan-out above the host cap runs by your earlier decision; the gate defers a batch below ${gate.deferBelowMemMb} MB.`
    : `The resource gate defers a batch below ${gate.deferBelowMemMb} MB free memory${carveOn ? '; the test-lock carve-out is on' : '; the test-lock wrapper is mandatory'}.`;
  return row('resource_policy', 'Resources', value, consequence);
}

/** The Wave scheduling row: path sharding, the hot-file lock and the batched-checks exception. Display-only. */
export function waveSchedulingRow(config: Obj): LaunchRow {
  if (absent(config, 'wave_scheduling')) {
    return row('wave_scheduling', 'Waves', 'absent: defaults', 'No path sharding or hot-file lock: parallel workers may collide on shared files.');
  }
  const w = sub(config, 'wave_scheduling');
  const shard = w.shard_by_touch_path === true;
  const hot = count(w.hot_files_max_one_per_wave);
  const batched = sub(w, 'batched_checks_pr').allowed === true;
  const value = [`shard by touch path ${shard ? 'on' : 'off'}`, plural(hot, 'hot file'), `batched-checks PR ${batched ? 'allowed' : 'not allowed'}`].join(' · ');
  const consequence = `${shard ? 'Workers are sharded by touch path' : 'Workers are not sharded by touch path'}; ${hot ? `each of ${plural(hot, 'hot file')} has at most one worker per wave` : 'no file is locked to one worker'}.`;
  return row('wave_scheduling', 'Waves', value, consequence);
}

/** Every key no row above claims, by name only: a top-level key, or `block.key` for a block a row reads only partly. Never a value. */
export function unclaimedKeys(config: Obj): string[] {
  const whole = new Set<string>();
  const keyed = new Map<string, Set<string>>();
  for (const claims of Object.values(LAUNCH_ROW_CLAIMS)) {
    for (const claim of claims) {
      if (typeof claim === 'string') whole.add(claim);
      else keyed.set(claim.block, new Set([...(keyed.get(claim.block) ?? []), ...claim.keys]));
    }
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (whole.has(key)) continue;
    const claimed = keyed.get(key);
    if (!claimed) out.push(key);
    else if (isObj(value)) out.push(...Object.keys(value).filter((k) => !claimed.has(k)).map((k) => `${key}.${k}`));
  }
  return out.sort();
}

/** The catch-all: what no other row shows, so a config block added later is never dropped from the gate. Display-only. */
export function otherConfigRow(config: Obj): LaunchRow {
  const names = unclaimedKeys(config);
  return row(
    'other_config',
    'Other',
    names.length ? names.join(', ') : 'none',
    names.length ? 'Keys no row above shows, by name only; their values are not printed.' : 'Every config key is shown in a row above.',
  );
}
