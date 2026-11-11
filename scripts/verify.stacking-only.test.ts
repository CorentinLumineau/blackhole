import { describe, expect, test } from 'bun:test';
import {
  CANONICAL_SENTENCE,
  evaluateStackingOnly,
  findDocsMissingSentence,
  findStackingOptOutKeys,
  runChecks,
} from './checks/stacking-only.check.ts';

const goodDocs = {
  'queue-dag.md': `Step 3b.\n\n${CANONICAL_SENTENCE}\n`,
  'merge-gate.md': 'Stacking is the only behavior (queue-dag.md Step 3b).',
  'config-template.md': 'Note: stacking is the only behavior, no key controls it.',
  'phase-loop.md': 'See queue-dag.md Step 3b: stacking is the only behavior.',
};

const template = (...rows: string[]) =>
  ['| Field | Required | Description |', '|---|---|---|', '| `merge_mode` | yes | how PRs land |', ...rows].join('\n');

describe('findStackingOptOutKeys', () => {
  test('flags a stacking key and any nested key with a stack segment', () => {
    expect(findStackingOptOutKeys(['merge_mode', 'stacking', 'queue.stack_prs', 'autonomy.level'])).toEqual(['stacking', 'queue.stack_prs']);
  });

  test('passes an unrelated key set', () => {
    expect(findStackingOptOutKeys(['merge_mode', 'target_branch'])).toEqual([]);
  });
});

describe('findDocsMissingSentence', () => {
  test('passes when queue-dag.md defines the sentence and the others cite it', () => {
    expect(findDocsMissingSentence(goodDocs)).toEqual([]);
  });

  test('names a doc that lacks it', () => {
    expect(findDocsMissingSentence({ ...goodDocs, 'merge-gate.md': 'nothing here' })).toEqual(['merge-gate.md']);
  });

  test('queue-dag.md must carry the full canonical sentence, not just a citation', () => {
    expect(findDocsMissingSentence({ ...goodDocs, 'queue-dag.md': 'stacking is the only behavior' })).toEqual(['queue-dag.md']);
  });
});

describe('evaluateStackingOnly', () => {
  test('passes a clean template, config and doc set', () => {
    expect(evaluateStackingOnly({ templateContent: template(), configs: [{ merge_mode: 'immediate' }], docs: goodDocs })).toEqual({
      id: 'V-STACK-03',
      ok: true,
    });
  });

  test('fails a template that gains a stacking row', () => {
    const r = evaluateStackingOnly({ templateContent: template('| `stacking` | no | turn stacking off |'), configs: [], docs: goodDocs });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('stacking');
  });

  test('fails a config fixture carrying `stacking: false`', () => {
    const r = evaluateStackingOnly({ templateContent: template(), configs: [{ stacking: false }], docs: goodDocs });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('stacking');
  });

  test('fails when a doc lacks the canonical sentence', () => {
    const r = evaluateStackingOnly({ templateContent: template(), configs: [], docs: { ...goodDocs, 'phase-loop.md': '' } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('phase-loop.md');
  });
});

describe('stacking-only runChecks() against the real src/ tree', () => {
  test('returns one passing V-STACK-03 result', () => {
    expect(runChecks()).toEqual([{ id: 'V-STACK-03', ok: true }]);
  });
});
