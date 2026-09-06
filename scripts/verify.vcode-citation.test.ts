import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { expandVcodeTableKey, parseVcodeTableRows, vcodeFamily } from './lib/check-common.ts';
import {
  KNOWN_CITATION_EXEMPTIONS,
  buildCitationFileIndex,
  codeAppearsIn,
  findUndocumentedEmittedCodes,
  parseCitationCell,
  parseEmittedVcodeIds,
  resolveSection,
  runChecks,
  scanVcodeCitations,
} from './checks/vcode-citation.check.ts';

const readFixtureText = (name: string): string =>
  fs.readFileSync(path.join(import.meta.dir, '..', 'fixtures', 'vcode-citation', name), 'utf-8');

// Issue #565 — vcode-citation.check.ts: resolves every blackhole-vcodes.md row's `Primary
// enforcement site` cell to a real file + section, and asserts the row's code appears inside
// that section's body (V-CITE-01 resolution, V-CITE-02 coverage), both BLOCK.

describe('parseCitationCell', () => {
  test('a numeric §N section ref', () => {
    expect(parseCitationCell('reviewer.md §3')).toEqual([{ file: 'reviewer.md', sectionRef: '§3' }]);
  });

  test('a numeric §N with a trailing parenthetical is stripped', () => {
    expect(parseCitationCell('reviewer.md §3 (V-SOLID-01 — SOLID & DRY Compliance)')).toEqual([
      { file: 'reviewer.md', sectionRef: '§3' },
    ]);
  });

  test('a named § Name section ref, up to the opening paren', () => {
    expect(parseCitationCell('router.md § Local-analyze confidence-boost mechanism (steps 1-4)')).toEqual([
      { file: 'router.md', sectionRef: 'Local-analyze confidence-boost mechanism' },
    ]);
  });

  test('a bare filename with no § at all falls back to sectionRef: null', () => {
    expect(parseCitationCell('router.md (local_analyze confidence-boost raise-only rule)')).toEqual([
      { file: 'router.md', sectionRef: null },
    ]);
  });

  test('a multi-level §4.8 ref falls back to sectionRef: null (no outline-numbering resolver)', () => {
    expect(parseCitationCell('planner.md §4.8')).toEqual([{ file: 'planner.md', sectionRef: null }]);
  });

  test('a multi-file cell splits on " + ", each segment parsed independently', () => {
    expect(parseCitationCell('scripts/design-aggregate.ts + planner.md §4.8')).toEqual([
      { file: 'scripts/design-aggregate.ts', sectionRef: null },
      { file: 'planner.md', sectionRef: null },
    ]);
  });
});

describe('resolveSection', () => {
  test('resolves a numeric §N heading and stops at the next equal-or-higher heading', () => {
    const content = '# Title\n\n## 1. First\n\nBody one.\n\n## 2. Second\n\nBody two.\n';
    const result = resolveSection(content, '§1');
    expect(result?.body).toContain('Body one.');
    expect(result?.body).not.toContain('Body two.');
  });

  test('resolves a named heading by prefix match', () => {
    const content = '## Some Gate (extra detail)\n\nContent here.\n\n## Next Section\n\nOther.\n';
    const result = resolveSection(content, 'Some Gate');
    expect(result?.body).toContain('Content here.');
    expect(result?.body).not.toContain('Other.');
  });

  test('returns null when the named heading is not found', () => {
    expect(resolveSection('## Unrelated\n\nBody.\n', 'Nonexistent Heading')).toBeNull();
  });

  test('returns null when the numeric heading is not found', () => {
    expect(resolveSection('## 1. First\n\nBody.\n', '§9')).toBeNull();
  });

  test('a null sectionRef never fails resolution — whole-file fallback', () => {
    expect(resolveSection('Just prose, no headings.\n', null)).toEqual({ body: 'Just prose, no headings.\n' });
  });
});

describe('codeAppearsIn', () => {
  test('a bare code found verbatim', () => {
    expect(codeAppearsIn('some text mentioning V-FAKE-01 here', 'V-FAKE-01')).toBe(true);
  });

  test('a combined code key is satisfied by at least one sub-code', () => {
    expect(codeAppearsIn('this section only mentions V-FAKE-02', 'V-FAKE-01/V-FAKE-02')).toBe(true);
  });

  test('absent code returns false', () => {
    expect(codeAppearsIn('nothing relevant here', 'V-FAKE-01')).toBe(false);
  });
});

describe('scanVcodeCitations (fixtures)', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeFixtureFile = (name: string, content: string): string => {
    const dir = makeTempDir('vcode-citation-');
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  test('known-bad: a citation naming a file that does not exist produces V-CITE-01', () => {
    const idx = new Map<string, string>(); // empty — no file resolves
    const scan = scanVcodeCitations([{ code: 'V-FAKE-01', site: 'nonexistent.md §1' }], idx);
    expect(scan.unresolved).toHaveLength(1);
    expect(scan.unresolved[0]).toMatch(/V-FAKE-01/);
    expect(scan.codeAbsent).toEqual([]);
  });

  test('a §N that does not exist in the fixture file falls back to whole-file and finds the code (no violation at all)', () => {
    const filePath = makeFixtureFile('fixture.md', '## 1. First\n\nBody mentions V-FAKE-01.\n');
    const idx = new Map([['fixture.md', filePath]]);
    const scan = scanVcodeCitations([{ code: 'V-FAKE-01', site: 'fixture.md §9' }], idx);
    expect(scan.unresolved).toEqual([]);
    expect(scan.codeAbsent).toEqual([]);
  });

  test('known-bad: a §N that does not exist falls back to whole-file, but the code is absent everywhere, producing V-CITE-02 (not V-CITE-01)', () => {
    const filePath = makeFixtureFile('fixture.md', '## 1. First\n\nNo code mentioned here at all.\n');
    const idx = new Map([['fixture.md', filePath]]);
    const scan = scanVcodeCitations([{ code: 'V-FAKE-01', site: 'fixture.md §9' }], idx);
    expect(scan.unresolved).toEqual([]);
    expect(scan.codeAbsent).toEqual(['V-FAKE-01']);
  });

  test('known-bad: a resolvable section whose body lacks the code produces V-CITE-02', () => {
    const filePath = makeFixtureFile('fixture.md', '## 1. First\n\nNo code mentioned here at all.\n');
    const idx = new Map([['fixture.md', filePath]]);
    const scan = scanVcodeCitations([{ code: 'V-FAKE-01', site: 'fixture.md §1' }], idx);
    expect(scan.unresolved).toEqual([]);
    expect(scan.codeAbsent).toEqual(['V-FAKE-01']);
  });

  test('known-good: a resolvable section whose body contains the code produces no violation', () => {
    const filePath = makeFixtureFile('fixture.md', '## 1. First\n\nThe rule is V-FAKE-01, cite it.\n');
    const idx = new Map([['fixture.md', filePath]]);
    const scan = scanVcodeCitations([{ code: 'V-FAKE-01', site: 'fixture.md §1' }], idx);
    expect(scan.unresolved).toEqual([]);
    expect(scan.codeAbsent).toEqual([]);
  });

  test('exemption: a named-exempted code with an absent string is skipped, not reported', () => {
    const filePath = makeFixtureFile('fixture.md', '## 1. First\n\nNo code mentioned here at all.\n');
    const idx = new Map([['fixture.md', filePath]]);
    // Production content is empty by design (see the check's own header comment) — push a
    // throwaway fixture code onto the live array to exercise the exemption mechanism itself,
    // then always pop it back off so this test never leaves production state mutated.
    const exemptedCode = 'V-FAKE-EXEMPT';
    KNOWN_CITATION_EXEMPTIONS.push(exemptedCode);
    try {
      const scan = scanVcodeCitations([{ code: exemptedCode, site: 'fixture.md §1' }], idx);
      expect(scan.unresolved).toEqual([]);
      expect(scan.codeAbsent).toEqual([]);
    } finally {
      KNOWN_CITATION_EXEMPTIONS.pop();
    }
  });
});

describe('buildCitationFileIndex', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('indexes files by both relative path and bare basename', () => {
    const agentsDir = makeTempDir('citation-agents-');
    const referencesDir = makeTempDir('citation-references-');
    tempDirs.push(agentsDir, referencesDir);
    fs.mkdirSync(path.join(referencesDir, 'hunt'));
    fs.writeFileSync(path.join(agentsDir, 'reviewer.md'), '# Reviewer\n');
    fs.writeFileSync(path.join(referencesDir, 'hunt', 'docs.md'), '# Docs\n');

    const idx = buildCitationFileIndex(agentsDir, referencesDir);
    expect(idx.get('reviewer.md')).toBe(path.join(agentsDir, 'reviewer.md'));
    expect(idx.get('hunt/docs.md')).toBe(path.join(referencesDir, 'hunt', 'docs.md'));
    expect(idx.get('docs.md')).toBe(path.join(referencesDir, 'hunt', 'docs.md'));
  });
});

describe('runChecks (live-tree assertion)', () => {
  test('V-CITE-01 is clean on the live tree — the generalized whole-file fallback resolves the V-HOOK pair', () => {
    const results = runChecks();
    const resolution = results.find((r) => r.id === 'V-CITE-01');
    expect(resolution?.ok).toBe(true);
  });

  test('V-CITE-02 is clean on the live tree with an empty exemption list — #564/#587/#588 closed the last three near-misses', () => {
    const results = runChecks();
    const coverage = results.find((r) => r.id === 'V-CITE-02');
    expect(coverage).toBeDefined();
    expect(coverage?.ok).toBe(true);
    expect(KNOWN_CITATION_EXEMPTIONS).toEqual([]);
  });
});

// Leg B — reverse-direction coverage: every `V-…` id emitted by a `scripts/checks/*.check.ts`
// module, in a code family `blackhole-vcodes.md` already owns, must have a table row (V-CITE-03).

describe('vcodeFamily', () => {
  test('strips the trailing numeric suffix', () => {
    expect(vcodeFamily('V-ADR-04')).toBe('V-ADR');
  });

  test('keeps multi-segment family names intact', () => {
    expect(vcodeFamily('V-DOC-GOV-02')).toBe('V-DOC-GOV');
  });
});

describe('expandVcodeTableKey', () => {
  test('a plain single-code key expands to itself', () => {
    expect(expandVcodeTableKey('V-ADR-01')).toEqual(['V-ADR-01']);
  });

  test('a slash-bundled key carries the family across bare numeric continuations', () => {
    expect(expandVcodeTableKey('V-ADA-05/06/07')).toEqual(['V-ADA-05', 'V-ADA-06', 'V-ADA-07']);
  });

  test('a key bundling two different families expands each whole code', () => {
    expect(expandVcodeTableKey('V-KISS-01 / V-YAGNI-01')).toEqual(['V-KISS-01', 'V-YAGNI-01']);
  });

  test('a non-code key expands to nothing', () => {
    expect(expandVcodeTableKey('Code')).toEqual([]);
  });
});

describe('parseEmittedVcodeIds', () => {
  test('extracts every `id: \'V-…\'` literal, in source order', () => {
    const source = readFixtureText('emitted-undocumented.check.ts.fixture');
    expect(parseEmittedVcodeIds(source)).toEqual(['V-FAKE-01', 'V-FAKE-02', 'V-OTHER-01']);
  });

  test('a module emitting no V-code ids yields an empty list', () => {
    expect(parseEmittedVcodeIds("const x = { id: 'not-a-vcode' };")).toEqual([]);
  });
});

describe('findUndocumentedEmittedCodes (fixtures)', () => {
  const documented = (): string[] =>
    parseVcodeTableRows(readFixtureText('vcodes-table-snippet.md')).flatMap((r) => expandVcodeTableKey(r.code));

  const emitted = (): { file: string; content: string }[] => [
    { file: 'fixture.check.ts', content: readFixtureText('emitted-undocumented.check.ts.fixture') },
  ];

  test('the fixture table expands its bundled key into whole codes', () => {
    expect(documented()).toEqual(['V-FAKE-01', 'V-BUNDLE-01', 'V-BUNDLE-02']);
  });

  test('known-bad: an id emitted in a documented family with no table row is reported with its file', () => {
    expect(findUndocumentedEmittedCodes(documented(), emitted())).toEqual(['V-FAKE-02 (fixture.check.ts)']);
  });

  test('known-good: adding the missing row silences the report', () => {
    expect(findUndocumentedEmittedCodes([...documented(), 'V-FAKE-02'], emitted())).toEqual([]);
  });

  test('an emitted id in a family the table never claimed is ignored, not reported', () => {
    expect(findUndocumentedEmittedCodes(documented(), emitted())).not.toContain('V-OTHER-01 (fixture.check.ts)');
  });

  test('no documented rows at all means no family is owned, so nothing is reported', () => {
    expect(findUndocumentedEmittedCodes([], emitted())).toEqual([]);
  });
});

describe('runChecks — V-CITE-03 (live tree)', () => {
  test('every emitted id in a documented family has a blackhole-vcodes.md row', () => {
    const coverage = runChecks().find((r) => r.id === 'V-CITE-03');
    expect(coverage).toBeDefined();
    expect(coverage?.detail ?? '').toBe('');
    expect(coverage?.ok).toBe(true);
  });
});
