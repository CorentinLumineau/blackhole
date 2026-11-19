import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { NOT_PROBED } from './budget.ts';
import {
  autonomyRow,
  LAUNCH_ROW_CLAIMS,
  LAUNCH_ROW_LABELS,
  otherConfigRow,
  resourcePolicyRow,
  runPacingRow,
  waveSchedulingRow,
  type RowClaim,
} from './launch-config-rows.ts';
import { buildLaunchSummary, gateCards, LAUNCH_ROW_KEYS, MAX_CONSEQUENCE_CHARS } from './launch-summary.ts';
import { buildStatusReport } from './report.ts';
import { loadCampaignState } from './state.ts';
import type { BudgetPanel, ForgeCounts, LaunchRowKey, PrSignal } from './types.ts';

const FIXTURES = path.resolve(import.meta.dir, '../../../fixtures/campaign-status');
const NOW_ISO = '2026-11-13T09:30:00.000Z';
const URL = 'https://claude.ai/code/artifact/abc';

const OVERRIDE_TEXT = `parallel_max raised by explicit owner instruction. ${'Conditions at the raise: plenty of free memory and a quiet host. '.repeat(10)}`;
const MERGE_NOTE = 'Owner note: auto-merge at LGTM with CI green, high-risk paths held.';

// The live config's shape, without secrets, plus every key a keyed claim lists with a non-default value.
const LIVE: Record<string, unknown> = {
  repo: 'acme/widgets',
  scope_milestone: 'v2.0',
  status_page: { enabled: true },
  target_branch: 'main',
  forge: 'github',
  parallel_max: 4,
  scratchpad_dir: '/tmp/campaign',
  size_label_prefix: 'size:',
  default_touch_paths: ['src/**'],
  issue_labels: { campaign: 'x' },
  scope_labels: ['x'],
  auto_sync: true,
  entry_mode: 'multitask',
  merge_mode: 'immediate',
  docs_governance: { enabled: true, write_governance: false, companion_files: true, docs_impact_routing: true, severity_overrides: {} },
  kaizen: { enabled: true, trigger: 'loops', loop_interval: 7 },
  autonomy: { mode: 'full', confidence_threshold: 90, design_autonomy: false, never_bypass: ['destructive'], granted_at: '2026-08-10', granted_by: 'owner', scope: 'all', merge_note: MERGE_NOTE },
  wave_scheduling: { shard_by_touch_path: true, hot_files_max_one_per_wave: ['a.ts', 'b.md'], rationale: 'why', batched_checks_pr: { allowed: true, rule: 'long rule' } },
  resource_policy: {
    fan_out_override: OVERRIDE_TEXT,
    mitigations: ['one', 'two', 'three'],
    testlock_carveout: { allowed: true, conditions: ['a', 'b', 'c', 'd'], scope: 'this repo' },
    gate: { defer_below_mem_mb: 3000 },
    pace: { max_age_seconds: 300 },
    carveout_recorded_at: '2026-08-11T10:21:07Z',
  },
  stop_budget_cleared_at: '2026-08-11T08:07:00Z',
  issue_484_disposition: { status: 'parked' },
  campaign_scope: { entries: [] },
  usage_budget: {
    enabled: true,
    five_hour: { no_spawn_at: 70, stop_workers_at: 80 },
    weekly: { no_new_starts_at: 60, stop_campaign_at: 70 },
    windows: ['seven_day'],
    max_workers: 2,
    coordination: { role: 'peer', manager_session: 'mgr-1', peer_floor: 2 },
  },
  usage_budget_note: 'note',
  catchup: { weekly_target_pct: 80 },
  sleep_mode: { enabled: false },
};

const probed = (over: Partial<BudgetPanel> = {}): BudgetPanel => ({ ...NOT_PROBED, probed: true, reason: null, source: 'rate-limit-cache', age_seconds: 120, ...over });

const online = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'full/forge.online.json'), 'utf-8')) as { forge: ForgeCounts; pr_signals: Record<string, PrSignal> };
const state = loadCampaignState(path.join(FIXTURES, 'full'));
const rowsOf = (config: Record<string, unknown>) =>
  buildLaunchSummary({
    report: buildStatusReport({ ...state, config, forge: online.forge, prSignals: online.pr_signals, paceLine: null, hostNotes: [], generatedAt: NOW_ISO, pluginVersion: '9.9.9' }),
    config,
    budget: probed(),
    statusPage: { enabled: true, publishExpected: true, artifact: { url: URL, kind: 'data', template_version: 4, last_probe: { at: NOW_ISO, ok: true, url: URL } }, templateVersion: 4, nowIso: NOW_ISO },
  });
const shown = (rows: ReturnType<typeof rowsOf>, key: LaunchRowKey): string => {
  const r = rows.find((x) => x.key === key);
  return `${r?.value}\n${r?.consequence}`;
};
const without = (config: Record<string, unknown>, block: string, key?: string): Record<string, unknown> => {
  const copy = structuredClone(config);
  if (key === undefined) delete copy[block];
  else delete (copy[block] as Record<string, unknown>)[key];
  return copy;
};

describe('LAUNCH_ROW_CLAIMS', () => {
  test('has exactly one entry per launch row key', () => {
    expect(Object.keys(LAUNCH_ROW_CLAIMS)).toEqual([...LAUNCH_ROW_KEYS]);
    expect(Object.keys(LAUNCH_ROW_LABELS)).toEqual([...LAUNCH_ROW_KEYS]);
  });

  test('a whole-block claim is exclusive and no (block, key) pair is claimed twice', () => {
    const all = Object.values(LAUNCH_ROW_CLAIMS).flat() as RowClaim[];
    const whole = all.filter((c): c is string => typeof c === 'string');
    expect(new Set(whole).size).toBe(whole.length);
    const keyed = all.filter((c): c is Exclude<RowClaim, string> => typeof c !== 'string');
    for (const block of whole) expect(keyed.filter((c) => c.block === block)).toEqual([]);
    const pairs = keyed.flatMap((c) => c.keys.map((k) => `${c.block}.${k}`));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test('every claimed key is read: removing it from a config carrying all claimed keys changes the owning row', () => {
    // Staging reads `enabled && write_governance !== false`: each key is observable only while the other is not masking it.
    const variants = [LIVE, { ...LIVE, docs_governance: { ...(LIVE.docs_governance as object), write_governance: true } }];
    const checked: string[] = [];
    for (const [rowKey, claims] of Object.entries(LAUNCH_ROW_CLAIMS) as [LaunchRowKey, readonly RowClaim[]][]) {
      for (const claim of claims) {
        const removals: Array<[string, string?]> = typeof claim === 'string' ? [[claim]] : claim.keys.map((k): [string, string] => [claim.block, k]);
        for (const [block, key] of removals) {
          // A block the fixture does not carry cannot be reduced: the fixture must carry every claim.
          expect(block in LIVE).toBe(true);
          if (key !== undefined) expect(key in (LIVE[block] as Record<string, unknown>)).toBe(true);
          if (rowKey === 'status_page' || rowKey === 'scope' || rowKey === 'merge' || rowKey === 'budget' || rowKey === 'sleep') continue;
          const changed = variants.some((v) => shown(rowsOf(without(v, block, key)), rowKey) !== shown(rowsOf(v), rowKey));
          expect({ row: rowKey, block, key, changed }).toEqual({ row: rowKey, block, key, changed: true });
          checked.push(`${rowKey}:${block}${key ? `.${key}` : ''}`);
        }
      }
    }
    expect(checked).toContain('autonomy:autonomy.design_autonomy');
    expect(checked).toContain('pacing:usage_budget.max_workers');
    expect(checked).toContain('pacing:catchup');
    expect(checked).toContain('peers:usage_budget.coordination');
    expect(checked).toHaveLength(24);
  });

  test('every built row carries the label LAUNCH_ROW_LABELS names for its key', () => {
    for (const r of rowsOf(LIVE)) expect(r.label).toBe(LAUNCH_ROW_LABELS[r.key]);
  });
});

describe('the run Pacing row', () => {
  test('an absent usage_budget and a disabled one read differently', () => {
    const absent = runPacingRow({}, NOT_PROBED);
    const disabled = runPacingRow({ usage_budget: { enabled: false } }, NOT_PROBED);
    expect(absent.value).toContain('usage_budget absent');
    expect(absent.consequence).toContain('off by default');
    expect(disabled.value).toContain('usage_budget disabled');
    expect(disabled.value).not.toContain('usage_budget absent');
    expect(absent.value).not.toBe(disabled.value);
  });

  test('an enabled budget shows both thresholds and the pace gate max age, 600 s by default', () => {
    const row = runPacingRow({ usage_budget: { enabled: true, five_hour: { no_spawn_at: 70, stop_workers_at: 80 }, weekly: { no_new_starts_at: 60, stop_campaign_at: 70 } } }, NOT_PROBED);
    expect(row.value).toContain('5h 70/80%');
    expect(row.value).toContain('weekly 60/70%');
    expect(row.value).toContain('pace gate max age 600 s');
    expect(runPacingRow({ usage_budget: { enabled: true }, resource_policy: { pace: { max_age_seconds: 120 } } }, NOT_PROBED).value).toContain('pace gate max age 120 s');
  });

  test('a probed panel names its source and age; a not-probed one names the reason', () => {
    expect(runPacingRow({}, probed()).value).toContain('reading source rate-limit-cache, 2 min old');
    const none = runPacingRow({}, { ...NOT_PROBED, reason: 'cache missing' });
    expect(none.value).toContain('no reading (cache missing)');
  });

  test('an invalid usage_budget is named, not thrown', () => {
    expect(runPacingRow({ usage_budget: { enabled: 'yes' } }, NOT_PROBED).value).toContain('usage_budget invalid');
  });

  test('is display-only: no question', () => {
    expect(gateCards([runPacingRow(LIVE, probed())], { printOnly: false })).toEqual([]);
  });
});

describe('the Autonomy, Resource policy and Wave scheduling rows', () => {
  test('Autonomy names the mode and what it decides without asking', () => {
    const row = autonomyRow({ autonomy: { mode: 'full' } });
    expect(row.value).toContain('mode full');
    for (const word of ['design approvals', 'split sign-offs', 'plan waivers', 'BLOCK remedies']) expect(row.consequence.toLowerCase()).toContain(word.toLowerCase());
  });

  test('Autonomy without a mode shows the confidence threshold, 80 by default', () => {
    const row = autonomyRow({});
    expect(row.value).toContain('mode unset');
    expect(row.value).toContain('confidence threshold 80');
    expect(autonomyRow({ autonomy: { confidence_threshold: 90 } }).consequence).toContain('confidence 90');
  });

  test('Resource policy shows presence and counts, never the free text', () => {
    const row = resourcePolicyRow(LIVE);
    expect(row.value).toContain('fan-out override set');
    expect(row.value).toContain('3 mitigations');
    expect(row.value).toContain('test-lock carve-out on (4 conditions)');
    expect(row.value + row.consequence).not.toContain('parallel_max raised');
    expect(OVERRIDE_TEXT.length).toBeGreaterThan(500);
  });

  test('Wave scheduling shows the shard flag, hot files and the batched-checks state', () => {
    const row = waveSchedulingRow(LIVE);
    expect(row.value).toContain('shard by touch path on');
    expect(row.value).toContain('2 hot files');
    expect(row.value).toContain('batched-checks PR allowed');
  });

  test('an absent block reads absent: defaults', () => {
    for (const r of [resourcePolicyRow({}), waveSchedulingRow({})]) expect(r.value).toBe('absent: defaults');
  });

  test('every new row is display-only, has a header of 12 characters at most and a consequence within the limit', () => {
    const configs = [LIVE, {}, { autonomy: {}, resource_policy: {}, wave_scheduling: {}, usage_budget: {} }];
    for (const config of configs) {
      for (const r of [runPacingRow(config, probed()), autonomyRow(config), resourcePolicyRow(config), waveSchedulingRow(config), otherConfigRow(config)]) {
        expect(r.adjustable).toBe(false);
        expect(r.header.length).toBeLessThanOrEqual(12);
        expect(r.consequence.length).toBeGreaterThan(0);
        expect(r.consequence.length).toBeLessThanOrEqual(MAX_CONSEQUENCE_CHARS);
      }
    }
  });

  test('the new rows add no question to the gate', () => {
    const asked = gateCards(rowsOf(LIVE), { printOnly: false }).flatMap((c) => c.questions).map((q) => q.row);
    expect(asked).toEqual(['scope', 'merge', 'budget', 'status_page', 'kaizen_staging']);
  });
});

describe('the Other config row', () => {
  const names = (config: Record<string, unknown>): string[] => otherConfigRow(config).value.split(', ');

  test('lists unclaimed top-level keys and unread sub-keys, sorted, by name', () => {
    const list = names(LIVE);
    for (const k of ['usage_budget_note', 'issue_484_disposition', 'default_touch_paths', 'campaign_scope', 'autonomy.merge_note', 'resource_policy.carveout_recorded_at', 'docs_governance.companion_files']) {
      expect(list).toContain(k);
    }
    expect(list).toEqual([...list].sort());
  });

  test('omits what a row shows: claimed sub-keys and whole-block claims', () => {
    const list = names(LIVE);
    expect(list).not.toContain('usage_budget.coordination');
    expect(list).not.toContain('usage_budget.max_workers');
    expect(list).not.toContain('autonomy.mode');
    for (const k of ['repo', 'merge_mode', 'parallel_max', 'catchup', 'sleep_mode', 'status_page', 'usage_budget', 'autonomy']) expect(list).not.toContain(k);
  });

  test('prints no value', () => {
    const row = otherConfigRow(LIVE);
    expect(row.value + row.consequence).not.toContain(MERGE_NOTE);
    expect(row.value + row.consequence).not.toContain('parallel_max raised');
  });

  test('a config whose keys are all claimed reads none', () => {
    const row = otherConfigRow({ repo: 'a/b', merge_mode: 'immediate', autonomy: { mode: 'full' } });
    expect(row.value).toBe('none');
    expect(row.consequence).toContain('Every config key is shown');
  });

  test('an invented top-level key is never dropped', () => {
    expect(names({ ...LIVE, zz_new_block: { x: 1 } })).toContain('zz_new_block');
  });
});
