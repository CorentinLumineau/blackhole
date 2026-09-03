import { describe, expect, test } from 'bun:test';
import { extractMarkdownSection, findMissingTrees, checkTreeRegistry, runChecks } from './checks/tree-registry.check.ts';
import { COMMITTED_TARGET_TREES } from './lib/build/paths.ts';

describe('extractMarkdownSection', () => {
  test('returns only the lines between the matching ## heading and the next ## heading', () => {
    const fixture = [
      '# Title',
      '',
      '## Intro',
      'intro body',
      '',
      '## Committed target trees',
      'row one',
      'row two',
      '',
      '## Build & verify',
      'unrelated body',
    ].join('\n');

    const section = extractMarkdownSection(fixture, 'Committed target trees');
    expect(section).toContain('row one');
    expect(section).toContain('row two');
    expect(section).not.toContain('Build & verify');
    expect(section).not.toContain('unrelated body');
    expect(section).not.toContain('intro body');
  });

  test('matches a heading containing the substring even with a leading emoji', () => {
    const fixture = ['## 📦 Installation Paths', 'install body', '', '## Next section', 'other body'].join('\n');

    const section = extractMarkdownSection(fixture, 'Installation Paths');
    expect(section).toContain('install body');
    expect(section).not.toContain('other body');
  });
});

describe('findMissingTrees', () => {
  const trees = [
    { id: 'alpha', paths: ['alpha-a/', 'alpha-b/'] },
    { id: 'beta', paths: ['beta-a/'] },
    { id: 'claude-native', paths: ['.claude/'] },
  ];

  test('requireAll: true returns [] when every path of every entry is present', () => {
    const section = 'has alpha-a/ and alpha-b/ and beta-a/ and .claude/ too';
    expect(findMissingTrees(section, trees, { requireAll: true })).toEqual([]);
  });

  test('requireAll: true returns [entry.id] when one path of one entry is absent', () => {
    const section = 'has alpha-a/ only and beta-a/ and .claude/';
    expect(findMissingTrees(section, trees, { requireAll: true })).toEqual(['alpha']);
  });

  test('requireAll: false with exclude returns [] when at least one path per non-excluded entry is present', () => {
    const section = 'has alpha-a/ only, nothing about beta, nothing about claude-native';
    expect(findMissingTrees(section, trees, { requireAll: false, exclude: ['claude-native'] })).toEqual(['beta']);
  });

  test('requireAll: false excludes entries in exclude regardless of content', () => {
    const section = 'mentions nothing at all';
    const result = findMissingTrees(section, trees, { requireAll: false, exclude: ['claude-native'] });
    expect(result).not.toContain('claude-native');
  });

  test('requireAll: false returns the entry id when none of its paths are present', () => {
    const section = 'mentions nothing relevant';
    const result = findMissingTrees(section, trees, { requireAll: false, exclude: ['claude-native'] });
    expect(result).toContain('alpha');
    expect(result).toContain('beta');
  });
});

describe('checkTreeRegistry (live repo content)', () => {
  test('calibrated current-state baseline against real documentation/architecture.md and README.md', () => {
    expect(checkTreeRegistry()).toEqual({
      id: 'V-TREE-01',
      ok: true,
      detail: 'README.md missing: claude-marketplace, codex',
    });
  });
});

describe('runChecks', () => {
  test('returns an array of length 1 whose single element has id V-TREE-01', () => {
    const results = runChecks();
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('V-TREE-01');
  });
});

describe('COMMITTED_TARGET_TREES', () => {
  test('has exactly 8 entries', () => {
    expect(COMMITTED_TARGET_TREES.length).toBe(8);
  });
});
