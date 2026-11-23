import { describe, expect, test } from 'bun:test';
import { findHintDrift, hintModes, modesTableModes, runChecks } from './checks/skill-modes-hint.check.ts';

// V-HINT-01: the SKILL.md argument-hint lists exactly the modes of its Modes table, by first word.

const skill = (hint: string, rows: string[]) =>
  ['---', 'name: blackhole', `argument-hint: "${hint}"`, '---', '', '## Modes', '', '| Mode | Trigger | Agent |', '|---|---|---|', ...rows, '', '## Next', '| `ghost` | x | y |'].join('\n');

describe('hintModes', () => {
  test('first word of each bracketed alternative, flags and placeholders dropped', () => {
    expect(hintModes(skill('[run | catchup [--unattended] | handle #N | hunt [kind] | stop [--abandon]]', []))).toEqual([
      'run', 'catchup', 'handle', 'hunt', 'stop',
    ]);
  });

  test('a SKILL.md with no argument-hint has none', () => {
    expect(hintModes('---\nname: x\n---\n')).toEqual([]);
  });
});

describe('modesTableModes', () => {
  test('the first word of every backticked mode in the first column, deduplicated, within the Modes section only', () => {
    const rows = ['| `run` | a | b |', '| `stop` (drain, default) | a | b |', '| `stop --abandon` | a | b |', '| `handle #N` | a | b |', '| `x` / `y` | a | b |'];
    expect(modesTableModes(skill('[]', rows))).toEqual(['run', 'stop', 'handle', 'x', 'y']);
  });
});

describe('findHintDrift', () => {
  test('both directions: a table mode missing from the hint, and a hint mode the table does not have', () => {
    const doc = skill('[run | sleep]', ['| `run` | a | b |', '| `decide` | a | b |']);
    expect(findHintDrift(doc)).toEqual([
      'mode "decide" is in the Modes table but not in argument-hint',
      'argument-hint lists "sleep", which the Modes table does not have',
    ]);
  });

  test('an aligned hint has no drift', () => {
    expect(findHintDrift(skill('[run | decide]', ['| `run` | a | b |', '| `decide` | a | b |']))).toEqual([]);
  });

  test('a missing hint or an empty table is drift, never a silent pass', () => {
    expect(findHintDrift('---\nname: x\n---\n\n## Modes\n\n| `run` | a | b |\n')).toContain('src/SKILL.md has no argument-hint');
    expect(findHintDrift(skill('[run]', []))).toContain('src/SKILL.md has no Modes table rows');
  });
});

describe('runChecks on the real src/SKILL.md', () => {
  test('passes', () => {
    expect(runChecks()).toEqual([{ id: 'V-HINT-01', ok: true }]);
  });
});
