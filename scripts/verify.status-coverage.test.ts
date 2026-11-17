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
  '| Block | Status page | Row | Reason |',
  '|-------|-------------|-----|--------|',
  '| `repo` | `links` | — | forge pages |',
  '| `parallel_max` | `config` | Concurrency | |',
  '| `sleep_mode` | `run` | Sleep mode | |',
  '| `scratchpad_dir` | none | — | where worktrees live; not run state |',
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
      { block: 'repo', dataset: 'links', rows: [], reason: 'forge pages' },
      { block: 'parallel_max', dataset: 'config', rows: ['Concurrency'], reason: '' },
      { block: 'sleep_mode', dataset: 'run', rows: ['Sleep mode'], reason: '' },
      { block: 'scratchpad_dir', dataset: 'none', rows: [], reason: 'where worktrees live; not run state' },
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
    expect(findStatusCoverageGaps(doc(replaced('scratchpad_dir', '| `scratchpad_dir` | none | — | |')), TEMPLATE)).toEqual([
      'scratchpad_dir: status page none needs a reason',
    ]);
  });

  test('a dataset the plugin does not write fails', () => {
    expect(findStatusCoverageGaps(doc(replaced('repo', '| `repo` | `forge_panel` | — | |')), TEMPLATE)).toEqual([
      'repo: "forge_panel" is not a status dataset (STATUS_DATASET_IDS)',
    ]);
  });

  test('a row the dataset does not emit fails', () => {
    const gaps = findStatusCoverageGaps(doc(replaced('parallel_max', '| `parallel_max` | `config` | Parallelism | |')), TEMPLATE);
    expect(gaps).toEqual([`parallel_max: "Parallelism" is not a row of the config dataset (${PANEL_ROW_KEYS.config.join(', ')})`]);
  });

  test('a stale row for an unregistered block, and a block listed twice, fail', () => {
    const coverage = [...COVERAGE.slice(0, -2), '| `gone_block` | `config` | — | |', '| `repo` | `links` | — | twice |', '', '## Next section'];
    expect(findStatusCoverageGaps(doc(coverage), TEMPLATE)).toEqual([
      `gone_block: listed in ${COVERAGE_HEADING} but registered in no field row`,
      `repo: listed twice in ${COVERAGE_HEADING}`,
    ]);
  });

  test('budget rows are checked against what budgetRows emits, several per cell', () => {
    expect(PANEL_ROW_KEYS.budget).toEqual(expect.arrayContaining(['Usage', 'Weekly', 'Weekly target', 'Workers allowed', 'Forecast']));
    const ok = '| `parallel_max` | `budget` | Workers allowed, Weekly target | |';
    expect(findStatusCoverageGaps(doc(replaced('parallel_max', ok)), `${TEMPLATE}<dl data-source="budget"></dl>`)).toEqual([]);
    const bad = '| `parallel_max` | `budget` | Weekly target, Monthly | |';
    expect(findStatusCoverageGaps(doc(replaced('parallel_max', bad)), `${TEMPLATE}<dl data-source="budget"></dl>`)).toEqual([
      `parallel_max: "Monthly" is not a row of the budget dataset (${PANEL_ROW_KEYS.budget.join(', ')})`,
    ]);
  });

  test('a registered sub-block may add its own row; an unregistered one fails', () => {
    const sub = [...COVERAGE.slice(0, -2), '| `sleep_mode.enabled` | `run` | Sleep mode | |', '| `sleep_mode.ghost` | `run` | — | |', '', '## Next section'];
    expect(findStatusCoverageGaps(doc(sub), TEMPLATE)).toEqual([`sleep_mode.ghost: listed in ${COVERAGE_HEADING} but registered in no field row`]);
  });

  test('the live config-template.md and template pass', () => {
    expect(runChecks()).toEqual([{ id: 'V-CONFIG-03', ok: true }]);
  });
});
