import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { makeTempDir } from './lib/fs.ts';
import {
  findLeakedBuildInputDirs,
  findUndeclaredIncludeMarkers,
  findSitesMissingMarker,
  findMarkersAtUndeclaredSites,
  REFERENCE_TREE_ROOTS,
  runChecks,
} from './checks/build-input-dirs.check.ts';
import { BUILD_INPUT_ONLY_DIRS, INCLUDE_MARKER_SITES } from './lib/build/facts.ts';

// ADR-034 T4 — V-INCLUDE-01: two-sided verification (ADR-007's binding rejection of
// single-source derivation). Leg A (findLeakedBuildInputDirs): the declared side
// (BUILD_INPUT_ONLY_DIRS) vs. an independent filesystem scan of the 9 compiled reference trees.
// Leg B (findUndeclaredIncludeMarkers): every {{INCLUDE:<dir>/*}} marker in src/agents/**
// /src/references/** names a directory that is actually declared. `makeTempDir` (scripts/lib/fs.ts)
// stands in for "fixture helpers in scripts/lib/test-fixtures.ts" here — that module's own
// fixtures are all build-pipeline-shaped (compileGeminiTree/compileCodexTree wiring), which this
// leg's pure functions don't need; a bare temp dir is the minimal fixture for a filesystem-
// presence check.

describe('findLeakedBuildInputDirs (V-INCLUDE-01, leg A)', () => {
  test('a declared directory present in one of the reference trees fails and names the offending tree+directory', () => {
    const treeA = makeTempDir('blackhole-include-tree-a');
    const treeB = makeTempDir('blackhole-include-tree-b');
    try {
      fs.mkdirSync(path.join(treeB, 'leaked-module'), { recursive: true });
      fs.writeFileSync(path.join(treeB, 'leaked-module', '01-mod.md'), 'leaked');

      const leaks = findLeakedBuildInputDirs(['references/leaked-module'], [treeA, treeB]);

      expect(leaks.length).toBe(1);
      expect(leaks[0]).toContain('references/leaked-module');
      expect(leaks[0]).toContain(path.basename(treeB));
    } finally {
      fs.rmSync(treeA, { recursive: true, force: true });
      fs.rmSync(treeB, { recursive: true, force: true });
    }
  });

  test('absent from all trees passes', () => {
    const treeA = makeTempDir('blackhole-include-tree-c');
    const treeB = makeTempDir('blackhole-include-tree-d');
    try {
      expect(findLeakedBuildInputDirs(['references/never-leaked'], [treeA, treeB])).toEqual([]);
    } finally {
      fs.rmSync(treeA, { recursive: true, force: true });
      fs.rmSync(treeB, { recursive: true, force: true });
    }
  });

  test('an empty declared list is a no-op pass', () => {
    const treeA = makeTempDir('blackhole-include-tree-e');
    try {
      fs.mkdirSync(path.join(treeA, 'anything'), { recursive: true });
      expect(findLeakedBuildInputDirs([], [treeA])).toEqual([]);
    } finally {
      fs.rmSync(treeA, { recursive: true, force: true });
    }
  });
});

describe('findUndeclaredIncludeMarkers (V-INCLUDE-01, leg B)', () => {
  test('a marker naming an undeclared directory fails', () => {
    const files = [{ path: 'src/agents/fake.md', content: 'body {{INCLUDE:references/undeclared/*}} more' }];
    const undeclared = findUndeclaredIncludeMarkers(files, ['references/declared']);
    expect(undeclared.length).toBe(1);
    expect(undeclared[0]).toContain('references/undeclared');
    expect(undeclared[0]).toContain('src/agents/fake.md');
  });

  test('a marker naming a declared directory passes', () => {
    const files = [{ path: 'src/agents/fake.md', content: '{{INCLUDE:references/declared/*}}' }];
    expect(findUndeclaredIncludeMarkers(files, ['references/declared'])).toEqual([]);
  });

  test('no markers at all passes', () => {
    const files = [{ path: 'src/agents/fake.md', content: 'plain content, no markers' }];
    expect(findUndeclaredIncludeMarkers(files, [])).toEqual([]);
  });
});

// V-INCLUDE-02 (ADR-039, issue #882) — two-sided verification for the declared
// INCLUDE_MARKER_SITES allowlist that gates expandIncludes itself (as opposed to V-INCLUDE-01's
// BUILD_INPUT_ONLY_DIRS, which gates a marker's *target* directory). Same Leg A/B shape as
// V-INCLUDE-01 above, applied to "where a marker may appear" instead of "where it may point".

describe('findSitesMissingMarker (V-INCLUDE-02, leg A)', () => {
  test('a declared site with no marker fails and names the site', () => {
    const siteFiles = [{ path: 'src/agents/reviewer.md', content: 'no marker in this shell' }];
    const missing = findSitesMissingMarker(siteFiles, ['src/agents/reviewer.md']);
    expect(missing.length).toBe(1);
    expect(missing[0]).toContain('src/agents/reviewer.md');
  });

  test('a declared site absent from disk fails and says so', () => {
    const missing = findSitesMissingMarker([], ['src/agents/__does_not_exist__.md']);
    expect(missing.length).toBe(1);
    expect(missing[0]).toContain('src/agents/__does_not_exist__.md');
    expect(missing[0]).toContain('does not exist');
  });

  test('a declared site carrying a marker passes', () => {
    const siteFiles = [{ path: 'src/agents/reviewer.md', content: '{{INCLUDE:references/audits/*}}' }];
    expect(findSitesMissingMarker(siteFiles, ['src/agents/reviewer.md'])).toEqual([]);
  });

  test('an empty declared list is a no-op pass', () => {
    expect(findSitesMissingMarker([], [])).toEqual([]);
  });
});

describe('findMarkersAtUndeclaredSites (V-INCLUDE-02, leg B)', () => {
  test('a marker at a file outside the declared set fails and names the file', () => {
    const files = [{ path: 'src/agents/fake.md', content: 'body {{INCLUDE:references/audits/*}} more' }];
    const undeclared = findMarkersAtUndeclaredSites(files, ['src/agents/reviewer.md']);
    expect(undeclared.length).toBe(1);
    expect(undeclared[0]).toContain('src/agents/fake.md');
  });

  test('a marker at a declared site passes', () => {
    const files = [{ path: 'src/agents/reviewer.md', content: '{{INCLUDE:references/audits/*}}' }];
    expect(findMarkersAtUndeclaredSites(files, ['src/agents/reviewer.md'])).toEqual([]);
  });

  test('no markers at all passes regardless of declared list', () => {
    const files = [{ path: 'src/agents/fake.md', content: 'plain content, no markers' }];
    expect(findMarkersAtUndeclaredSites(files, [])).toEqual([]);
  });
});

describe('REFERENCE_TREE_ROOTS', () => {
  test('names exactly the 9 compiled reference-tree roots, all existing on disk (ADR-034)', () => {
    expect(REFERENCE_TREE_ROOTS.length).toBe(9);
    for (const rel of REFERENCE_TREE_ROOTS) {
      expect(fs.existsSync(path.join(root, rel)), `missing reference tree: ${rel}`).toBe(true);
    }
  });
});

describe('runChecks live tree (V-INCLUDE-01, V-INCLUDE-02)', () => {
  test('passes against the live repo — implementer.md gates (issue #721) and reviewer audit modules are both production consumers', () => {
    expect(BUILD_INPUT_ONLY_DIRS).toEqual(['references/gates', 'references/audits']);
    expect(INCLUDE_MARKER_SITES).toEqual(['src/agents/reviewer.md', 'src/agents/implementer.md']);
    const results = runChecks();
    expect(results.length).toBe(2);
    const v1 = results.find((r) => r.id === 'V-INCLUDE-01');
    const v2 = results.find((r) => r.id === 'V-INCLUDE-02');
    expect(v1?.ok).toBe(true);
    expect(v2?.ok).toBe(true);
  });
});
