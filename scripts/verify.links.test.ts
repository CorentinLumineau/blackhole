import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  walkMdFilesAbs,
  extractMarkdownLinkTargets,
  findDeadMarkdownLinks,
  findAdrCrossReferenceErrors,
} from './checks/links.check.ts';
import { makeTempDir as sharedMakeTempDir } from './lib/fs.ts';

const makeTempDir = (): string => sharedMakeTempDir('blackhole-verify-vcode-test');

// The recursive walk itself (nested/symlink/hidden/empty cases, incl. the #216 EISDIR
// regression) is exercised against the shared primitive in scripts/lib/fs.test.ts. This suite
// keeps only a thin-wrapper contract check: walkMdFilesAbs still filters to .md files.
describe('walkMdFilesAbs', () => {
  test('filters to .md files only and ignores non-.md siblings', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'top-level.md'), '# top\nV-TOP-01\n');
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'not markdown');
      fs.mkdirSync(path.join(dir, 'nested'));
      fs.writeFileSync(path.join(dir, 'nested', 'child.md'), '# nested\nV-NESTED-01\n');

      const files = walkMdFilesAbs(dir);
      expect(files.sort()).toEqual(
        [path.join(dir, 'top-level.md'), path.join(dir, 'nested', 'child.md')].sort()
      );

      const corpus = files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
      expect(corpus).toContain('V-TOP-01');
      expect(corpus).toContain('V-NESTED-01');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns [] for a directory that does not exist', () => {
    expect(walkMdFilesAbs(path.join(makeTempDir(), 'does-not-exist'))).toEqual([]);
  });
});

// V-LINK-01 (ADR-007 T4/R7): markdown cross-reference integrity — src/**/*.md link targets
// resolve on disk, and documentation/decisions/*.md ADR cross-references resolve locally.
describe('extractMarkdownLinkTargets', () => {
  test('extracts relative link targets, skipping fenced code, http(s)/mailto, and anchor-only links', () => {
    const content = [
      'See [a](./a.md) and [b](../hunt/quickwins.md).',
      '```md',
      '[fenced](./should-be-skipped.md)',
      '```',
      'External [site](https://example.com), [mail](mailto:a@b.com), [anchor](#section) are skipped.',
    ].join('\n');

    expect(extractMarkdownLinkTargets(content)).toEqual([
      { line: 1, target: './a.md' },
      { line: 1, target: '../hunt/quickwins.md' },
    ]);
  });
});

describe('findDeadMarkdownLinks', () => {
  const makeTempDir = (): string => sharedMakeTempDir('blackhole-verify-link-test');

  test('a same-directory relative link that resolves to an existing file passes', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'b.md'), '# b');
      expect(findDeadMarkdownLinks(path.join(dir, 'a.md'), '[b](./b.md)')).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a ../hunt/-style relative link that resolves to an existing file passes', () => {
    const dir = makeTempDir();
    try {
      fs.mkdirSync(path.join(dir, 'hunt'));
      fs.writeFileSync(path.join(dir, 'hunt', 'quickwins.md'), '# quickwins');
      fs.mkdirSync(path.join(dir, 'references'));
      const content = '[quickwins](../hunt/quickwins.md)';
      expect(findDeadMarkdownLinks(path.join(dir, 'references', 'a.md'), content)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a dead link fails naming the exact file and line', () => {
    const dir = makeTempDir();
    try {
      const content = '# Title\n\n[missing](./does-not-exist.md)';
      const errors = findDeadMarkdownLinks(path.join(dir, 'a.md'), content, 'src/a.md');
      expect(errors).toEqual(['src/a.md:3: dead link -> ./does-not-exist.md']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('findAdrCrossReferenceErrors', () => {
  const makeTempDir = (): string => sharedMakeTempDir('blackhole-verify-adr-link-test');

  test('a stale related: frontmatter entry fails', () => {
    const dir = makeTempDir();
    try {
      const decisionsDir = path.join(dir, 'documentation', 'decisions');
      fs.mkdirSync(decisionsDir, { recursive: true });
      fs.writeFileSync(
        path.join(decisionsDir, 'ADR-001-example.md'),
        '---\nrelated:\n  - documentation/decisions/does-not-exist.md\n---\n\n# ADR-001: Example\n',
      );

      expect(findAdrCrossReferenceErrors(dir)).toEqual([
        'documentation/decisions/ADR-001-example.md: related: entry does not exist -> documentation/decisions/does-not-exist.md',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a valid related: entry and a self-resolving inline ADR-NNN mention pass', () => {
    const dir = makeTempDir();
    try {
      const decisionsDir = path.join(dir, 'documentation', 'decisions');
      fs.mkdirSync(decisionsDir, { recursive: true });
      fs.writeFileSync(path.join(decisionsDir, 'ADR-001-example.md'), '---\n---\n\n# ADR-001: Example\n');
      fs.writeFileSync(
        path.join(decisionsDir, 'ADR-002-example.md'),
        '---\nrelated:\n  - documentation/decisions/ADR-001-example.md\n---\n\nSee [ADR-001](ADR-001-example.md).\n',
      );

      expect(findAdrCrossReferenceErrors(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an inline ADR-NNN mention with no local file fails unless allowlisted', () => {
    const dir = makeTempDir();
    try {
      const decisionsDir = path.join(dir, 'documentation', 'decisions');
      fs.mkdirSync(decisionsDir, { recursive: true });
      fs.writeFileSync(
        path.join(decisionsDir, 'ADR-001-example.md'),
        '# ADR-001: Example\n\nSee ADR-099 (external) and ADR-100 (unresolved).\n',
      );

      expect(findAdrCrossReferenceErrors(dir, new Set(['099']))).toEqual([
        'documentation/decisions/ADR-001-example.md: inline mention of ADR-100 does not resolve to a local documentation/decisions/ADR-100-*.md file',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns [] when documentation/decisions does not exist (e.g. a repo fixture without ADRs)', () => {
    const dir = makeTempDir();
    try {
      expect(findAdrCrossReferenceErrors(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
