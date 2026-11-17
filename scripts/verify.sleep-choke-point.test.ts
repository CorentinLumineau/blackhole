import { describe, expect, test } from 'bun:test';
import {
  DESCRIPTIVE_MENTIONS,
  findUnroutedAsks,
  playbookFiles,
  runChecks,
} from './checks/sleep-choke-point.check.ts';

// V-SLEEP-01: every playbook section that tells the model to ask the owner routes the question
// through askOrPark() / clarify-gates.md § C3 adapter, so sleep mode can park it.

const doc = (path: string, content: string) => ({ path, content });
const UNROUTED = 'asks the owner without askOrPark() / clarify-gates.md § C3 adapter';

describe('findUnroutedAsks', () => {
  test('an ask with no route in its section fails, naming the file and section', () => {
    const errors = findUnroutedAsks([doc('src/references/x.md', '# X\n\n## Gate\n\nUse `AskQuestion` to confirm.\n')], []);
    expect(errors).toEqual([`src/references/x.md § Gate: ${UNROUTED}`]);
  });

  test('an AskUserQuestion mention is caught as well as AskQuestion', () => {
    expect(findUnroutedAsks([doc('a.md', '## G\nOne AskUserQuestion call.\n')], [])).toEqual([`a.md § G: ${UNROUTED}`]);
  });

  test('a route anywhere in the same section passes', () => {
    for (const route of ['`askOrPark()`', 'clarify-gates.md § C3 adapter', 'the C3 adapter row for this session', '`clarify-gates.md` § Gate Content Contract', '`sleep-mode.md`']) {
      expect(findUnroutedAsks([doc('a.md', `## G\nUse AskQuestion.\n\nRouted via ${route}.\n`)], [])).toEqual([]);
    }
  });

  test('a route in a sibling section does not cover the ask', () => {
    const content = '## Routed\nSee `askOrPark()`.\n\n## Gate\nUse AskQuestion.\n';
    expect(findUnroutedAsks([doc('a.md', content)], [])).toEqual([`a.md § Gate: ${UNROUTED}`]);
  });

  test('the section is the innermost heading: a parent route does not cover a sub-section ask', () => {
    const content = '## Parent\nSee `askOrPark()`.\n\n### Child\nUse AskQuestion.\n';
    expect(findUnroutedAsks([doc('a.md', content)], [])).toEqual([`a.md § Child: ${UNROUTED}`]);
  });

  test('a mention before the first heading is checked as the preamble', () => {
    expect(findUnroutedAsks([doc('a.md', 'Use AskQuestion first.\n# Title\n')], [])).toEqual([`a.md § (preamble): ${UNROUTED}`]);
  });

  test('a heading inside a code fence does not start a section', () => {
    const content = '## G\nSee `askOrPark()`.\n```\n## not a heading\n```\nUse AskQuestion.\n';
    expect(findUnroutedAsks([doc('a.md', content)], [])).toEqual([]);
  });

  test('an allowlisted section passes; a whole-file entry covers every section', () => {
    const files = [doc('a.md', '## Table\nAskQuestion row.\n'), doc('b.md', '## One\nAskQuestion.\n## Two\nAskQuestion.\n')];
    const allow = [
      { file: 'a.md', section: 'Table', why: 'descriptive' },
      { file: 'b.md', section: '*', why: 'the contract itself' },
    ];
    expect(findUnroutedAsks(files, allow)).toEqual([]);
  });

  test('an allowlisted section of one file does not cover the same heading in another file', () => {
    const files = [doc('a.md', '## Table\nAskQuestion.\n'), doc('b.md', '## Table\nAskQuestion.\n')];
    expect(findUnroutedAsks(files, [{ file: 'a.md', section: 'Table', why: 'descriptive' }])).toEqual([`b.md § Table: ${UNROUTED}`]);
  });

  test('a stale allowlist entry fails, so the list cannot rot', () => {
    const errors = findUnroutedAsks([doc('a.md', '## Other\nnothing\n')], [{ file: 'a.md', section: 'Table', why: 'gone' }]);
    expect(errors).toEqual(['allowlist entry a.md § Table matches no section that mentions a question tool']);
  });
});

describe('the live playbooks', () => {
  test('scans src/agents and src/references and finds the question-tool mentions', () => {
    const files = playbookFiles();
    expect(files.some((f) => f.path === 'src/references/clarify-gates.md')).toBe(true);
    expect(files.some((f) => f.path === 'src/agents/coordinator.md')).toBe(true);
    expect(files.filter((f) => /\bAsk(?:User)?Question\b/.test(f.content)).length).toBeGreaterThan(10);
  });

  test('every allowlist entry states why the mention is descriptive', () => {
    for (const entry of DESCRIPTIVE_MENTIONS) expect(entry.why.length).toBeGreaterThan(10);
  });

  test('V-SLEEP-01 passes on the tree', () => {
    expect(runChecks()).toEqual([{ id: 'V-SLEEP-01', ok: true }]);
  });
});
