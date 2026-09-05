import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { makeTempDir } from './lib/fs.ts';
import {
  findLeakedBuildInputDirs,
  findUndeclaredIncludeMarkers,
  REFERENCE_TREE_ROOTS,
  runChecks,
} from './checks/build-input-dirs.check.ts';
import { BUILD_INPUT_ONLY_DIRS } from './lib/build/facts.ts';

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

describe('REFERENCE_TREE_ROOTS', () => {
  test('names exactly the 9 compiled reference-tree roots, all existing on disk (ADR-034)', () => {
    expect(REFERENCE_TREE_ROOTS.length).toBe(9);
    for (const rel of REFERENCE_TREE_ROOTS) {
      expect(fs.existsSync(path.join(root, rel)), `missing reference tree: ${rel}`).toBe(true);
    }
  });
});

describe('runChecks live tree (V-INCLUDE-01)', () => {
  test('passes against the live repo — implementer.md is the production consumer (issue #721)', () => {
    expect(BUILD_INPUT_ONLY_DIRS).toEqual(['references/gates']);
    const results = runChecks();
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('V-INCLUDE-01');
    expect(results[0].ok).toBe(true);
  });
});
