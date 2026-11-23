import { readFileSync } from 'fs';
import { describe, expect, test } from 'bun:test';
import {
  COVERAGE_HEADING,
  findStatusCoverageGaps,
  parseCoverageTable,
  PANEL_ROW_KEYS,
  runChecks,
} from './checks/status-coverage.check.ts';

const FIELDS = [
  '| Field | Required | Description |',
  '|-------|----------|-------------|',
  '| `repo` | yes | owner/name |',
  '| `parallel_max` | no | workers |',
  '| `sleep_mode.enabled` | no | park owner questions |',
  '| `scratchpad_dir` | no | worktree parent |',
  '',
  'Prose after the table.',
];

const COVERAGE = [
  COVERAGE_HEADING,
  '',
  '| Block | Status page | Row | Reason | Launch summary |',
  '|-------|-------------|-----|--------|----------------|',
  '| `repo` | `links` | — | forge pages | Scope |',
  '| `parallel_max` | `config` | Concurrency | | Budget |',
  '| `sleep_mode` | `run` | Decisions | | Decisions |',
  '| `scratchpad_dir` | none | — | where worktrees live; not run state | Other config |',
  '',
  '## Next section',
];

const TEMPLATE = '<dl data-source="config"></dl><dl data-source="run"></dl><ul data-source="links"></ul>';

const doc = (coverage: string[] = COVERAGE): string => ['# Config', '', ...FIELDS, '', ...coverage].join('\n');
const without = (block: string): string[] => COVERAGE.filter((l) => !l.startsWith(`| \`${block}\``));
const replaced = (block: string, row: string): string[] => COVERAGE.map((l) => (l.startsWith(`| \`${block}\``) ? row : l));

describe('V-CONFIG-03 status page coverage', () => {
  test('a block mapped to a drawn dataset, or to none with a reason, passes', () => {
    expect(findStatusCoverageGaps(doc(), TEMPLATE)).toEqual([]);
  });

  test('parses the table: dataset, row (— is none) and reason', () => {
    expect(parseCoverageTable(doc())).toEqual([
      { block: 'repo', dataset: 'links', rows: [], reason: 'forge pages', launch: ['Scope'] },
      { block: 'parallel_max', dataset: 'config', rows: ['Concurrency'], reason: '', launch: ['Budget'] },
      { block: 'sleep_mode', dataset: 'run', rows: ['Decisions'], reason: '', launch: ['Decisions'] },
      { block: 'scratchpad_dir', dataset: 'none', rows: [], reason: 'where worktrees live; not run state', launch: ['Other config'] },
    ]);
  });

  test('removing a panel mapping fails: the block declares nothing', () => {
    expect(findStatusCoverageGaps(doc(without('sleep_mode')), TEMPLATE)).toEqual([
      `sleep_mode: registered in config-template.md but declares no status dataset or none (${COVERAGE_HEADING})`,
    ]);
  });

  test('no coverage section at all fails every registered block', () => {
    expect(findStatusCoverageGaps(doc([]), TEMPLATE)).toHaveLength(4);
  });

  test('removing the panel from the template fails the block that names its dataset', () => {
    expect(findStatusCoverageGaps(doc(), TEMPLATE.replace('<dl data-source="run"></dl>', ''))).toEqual([
      'sleep_mode: dataset "run" is drawn by no panel of templates/status-dashboard/index.html',
    ]);
  });

  test('none without a reason fails', () => {
    expect(findStatusCoverageGaps(doc(replaced('scratchpad_dir', '| `scratchpad_dir` | none | — | | Other config |')), TEMPLATE)).toEqual([
      'scratchpad_dir: status page none needs a reason',
    ]);
  });

  test('a dataset the plugin does not write fails', () => {
    expect(findStatusCoverageGaps(doc(replaced('repo', '| `repo` | `forge_panel` | — | | Scope |')), TEMPLATE)).toEqual([
      'repo: "forge_panel" is not a status dataset (STATUS_DATASET_IDS)',
    ]);
  });

  test('a row the dataset does not emit fails', () => {
    const gaps = findStatusCoverageGaps(doc(replaced('parallel_max', '| `parallel_max` | `config` | Parallelism | | Budget |')), TEMPLATE);
    expect(gaps).toEqual([`parallel_max: "Parallelism" is not a row of the config dataset (${PANEL_ROW_KEYS.config.join(', ')})`]);
  });

  test('a stale row for an unregistered block, and a block listed twice, fail', () => {
    const coverage = [...COVERAGE.slice(0, -2), '| `gone_block` | `config` | — | | Other config |', '| `repo` | `links` | — | twice | Scope |', '', '## Next section'];
    expect(findStatusCoverageGaps(doc(coverage), TEMPLATE)).toEqual([
      `gone_block: listed in ${COVERAGE_HEADING} but registered in no field row`,
      `repo: listed twice in ${COVERAGE_HEADING}`,
    ]);
  });

  test('budget rows are checked against what budgetRows emits, several per cell', () => {
    expect(PANEL_ROW_KEYS.budget).toEqual(expect.arrayContaining(['Usage', 'Weekly', 'Weekly target', 'Workers allowed', 'Forecast']));
    const ok = '| `parallel_max` | `budget` | Workers allowed, Weekly target | | Budget |';
    expect(findStatusCoverageGaps(doc(replaced('parallel_max', ok)), `${TEMPLATE}<dl data-source="budget"></dl>`)).toEqual([]);
    const bad = '| `parallel_max` | `budget` | Weekly target, Monthly | | Budget |';
    expect(findStatusCoverageGaps(doc(replaced('parallel_max', bad)), `${TEMPLATE}<dl data-source="budget"></dl>`)).toEqual([
      `parallel_max: "Monthly" is not a row of the budget dataset (${PANEL_ROW_KEYS.budget.join(', ')})`,
    ]);
  });

  test('a registered sub-block may add its own row; an unregistered one fails', () => {
    const sub = [...COVERAGE.slice(0, -2), '| `sleep_mode.enabled` | `run` | Decisions | |', '| `sleep_mode.ghost` | `run` | — | |', '', '## Next section'];
    expect(findStatusCoverageGaps(doc(sub), TEMPLATE)).toEqual([`sleep_mode.ghost: listed in ${COVERAGE_HEADING} but registered in no field row`]);
  });

  describe('launch summary leg', () => {
    test('a top-level block with no launch summary cell fails; a sub-block may use —', () => {
      expect(findStatusCoverageGaps(doc(replaced('parallel_max', '| `parallel_max` | `config` | Concurrency | | |')), TEMPLATE)).toEqual([
        `parallel_max: declares no launch summary row or Other config (${COVERAGE_HEADING})`,
      ]);
      const sub = [...COVERAGE.slice(0, -2), '| `sleep_mode.enabled` | `run` | Decisions | | — |', '', '## Next section'];
      expect(findStatusCoverageGaps(doc(sub), TEMPLATE)).toEqual([]);
    });

    test('a label that is no launch summary row fails', () => {
      expect(findStatusCoverageGaps(doc(replaced('parallel_max', '| `parallel_max` | `config` | Concurrency | | Workers |')), TEMPLATE)).toEqual([
        'parallel_max: "Workers" is not a launch summary row (LAUNCH_ROW_LABELS)',
        'parallel_max: claimed by the Budget row (LAUNCH_ROW_CLAIMS) but its Launch summary cell does not name it',
      ]);
    });

    test('a label repeated within one cell fails', () => {
      expect(findStatusCoverageGaps(doc(replaced('parallel_max', '| `parallel_max` | `config` | Concurrency | | Budget, Budget |')), TEMPLATE)).toEqual([
        'parallel_max: "Budget" is named twice in its Launch summary cell',
      ]);
    });

    test('a row that does not claim the block fails', () => {
      expect(findStatusCoverageGaps(doc(replaced('repo', '| `repo` | `links` | — | forge pages | Merge, Scope |')), TEMPLATE)).toEqual([
        'repo: the Merge row does not claim it (LAUNCH_ROW_CLAIMS)',
      ]);
    });

    test('Other config on a claimed block fails, and so does a claim the cell leaves out', () => {
      expect(findStatusCoverageGaps(doc(replaced('sleep_mode', '| `sleep_mode` | `run` | Decisions | | Other config |')), TEMPLATE)).toEqual([
        'sleep_mode: Other config, but the Decisions row shows it (LAUNCH_ROW_CLAIMS)',
        'sleep_mode: claimed by the Decisions row (LAUNCH_ROW_CLAIMS) but its Launch summary cell does not name it',
      ]);
    });

    test('a sub-block row is checked against keyed claims', () => {
      const fields = doc().replace('| `scratchpad_dir` | no |', '| `usage_budget.coordination` | no | peers |\n| `usage_budget.enabled` | no | pacing |\n| `scratchpad_dir` | no |');
      const ok = [...COVERAGE.slice(0, -2), '| `usage_budget` | `run` | Decisions | | Pacing, Peers |', '| `usage_budget.coordination` | `run` | Decisions | | Peers |', '', '## Next section'].join('\n');
      const base = fields.split(COVERAGE_HEADING)[0];
      expect(findStatusCoverageGaps(`${base}${ok}`, TEMPLATE)).toEqual([]);
      const bad = ok.replace('| `usage_budget.coordination` | `run` | Decisions | | Peers |', '| `usage_budget.coordination` | `run` | Decisions | | Pacing |');
      expect(findStatusCoverageGaps(`${base}${bad}`, TEMPLATE)).toEqual(['usage_budget.coordination: the Pacing row does not claim it (LAUNCH_ROW_CLAIMS)']);
    });
  });

  test('the live config-template.md and template pass', () => {
    expect(runChecks()).toEqual([{ id: 'V-CONFIG-03', ok: true }]);
  });

  test('the live template declares catchup as none, with a reason', () => {
    const rows = parseCoverageTable(readFileSync('src/references/config-template.md', 'utf-8'));
    const row = rows.find((r) => r.block === 'catchup');
    expect(row).toMatchObject({ dataset: 'none', rows: [] });
    expect(row?.reason).not.toBe('');
  });
});
