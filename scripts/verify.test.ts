import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  walkMdFilesAbs,
  findMissingGateMarkers,
  isAgentCountError,
  findHarnessTokenLeaks,
  extractMarkdownLinkTargets,
  findDeadMarkdownLinks,
  findAdrCrossReferenceErrors,
} from './verify.ts';
import { codexTreeErrors } from './tree-shape.ts';
import { AGENT_YAML_FILES } from './build.ts';
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

describe('findMissingGateMarkers', () => {
  test('returns the subset of required markers absent from content', () => {
    const content = '5-step gate\n**IDENTIFY** — what needs verification?\n**RUN** — execute now.';
    const required = ['5-step gate', '**IDENTIFY**', '**RUN**', '**READ**', '**VERIFY**', '**CLAIM**'];
    expect(findMissingGateMarkers(content, required)).toEqual(['**READ**', '**VERIFY**', '**CLAIM**']);
  });

  test('returns [] when all required markers are present', () => {
    const content = '5-step gate\n**IDENTIFY**\n**RUN**\n**READ**\n**VERIFY**\n**CLAIM**';
    const required = ['5-step gate', '**IDENTIFY**', '**RUN**', '**READ**', '**VERIFY**', '**CLAIM**'];
    expect(findMissingGateMarkers(content, required)).toEqual([]);
  });
});

describe('isAgentCountError (V-CODEX-04 filter — #234)', () => {
  test('matches the real agent-count mismatch message codexTreeErrors emits', () => {
    // Simulate codexTreeErrors output with a mismatch: pass zero agent files against the real
    // expected count derived from AGENT_YAML_FILES (SSOT, no hardcoded literal — V-DRY-03).
    // A nonexistent root means the SKILL.md/references checks also fire, giving us unrelated
    // messages in the same array to prove the filter discriminates correctly.
    const bogusRoot = path.join(os.tmpdir(), 'blackhole-verify-vcodex04-nonexistent-root');
    const errors = codexTreeErrors(bogusRoot, [], AGENT_YAML_FILES.size);

    const countError = errors.find((e) => e.includes('agent YAML files'));
    expect(countError).toBeDefined();
    expect(countError).toBe(`Codex: expected ${AGENT_YAML_FILES.size} agent YAML files, got 0`);
    expect(isAgentCountError(countError!)).toBe(true);
  });

  test('does not match unrelated codexTreeErrors messages (SKILL.md / references / per-file)', () => {
    expect(isAgentCountError('Codex: missing codex-skills/blackhole/SKILL.md')).toBe(false);
    expect(isAgentCountError('Codex: missing or empty codex-skills/blackhole/references/')).toBe(false);
    expect(isAgentCountError('Codex: some-agent.yaml missing instructions block scalar')).toBe(false);
  });
});

describe('findHarnessTokenLeaks (V-HARNESS-01 — #245)', () => {
  test('fail-closed: appendix marker absent treats the whole file as core — a stray token anywhere fails', () => {
    const content = [
      '# Claude Code-Native Orchestration (Pattern C)',
      '',
      '## Capability matrix (core — harness-neutral)',
      '',
      '| C1 | A fan-out mechanism with wave barriers |',
      '',
      'Some later prose that mentions the `Workflow tool` without any appendix marker present.',
    ].join('\n');

    const leaks = findHarnessTokenLeaks(content);
    expect(leaks.length).toBe(1);
    expect(leaks[0]).toContain('Workflow tool');
  });

  test('returns [] for a clean harness-neutral core with tokens confined to the appendix', () => {
    const content = [
      '# Claude Code-Native Orchestration (Pattern C)',
      '',
      '## Capability matrix (core — harness-neutral)',
      '',
      '| Capability | What it provides |',
      '| C1 | A fan-out mechanism with wave barriers |',
      '',
      '## Per-harness mapping appendix',
      '',
      '{{#claude}}',
      '### Claude Code',
      'C1 uses the `Workflow` tool (`parallel()` / `pipeline()`).',
      'C3 is the `AskUserQuestion` tool. Resume uses `resumeFromRunId` and `subagentStop`.',
      '{{/claude}}',
    ].join('\n');

    expect(findHarnessTokenLeaks(content)).toEqual([]);
  });

  test('returns one [token@context] entry per leaked token found before the appendix marker', () => {
    const content = [
      '# Claude Code-Native Orchestration (Pattern C)',
      '',
      '## Capability matrix (core — harness-neutral)',
      '',
      'C1 is the `Workflow tool` fan-out primitive with `parallel(` batches.',
      '',
      '## Per-harness mapping appendix',
      '',
      '{{#claude}}',
      'C3 is the `AskUserQuestion` tool.',
      '{{/claude}}',
    ].join('\n');

    const leaks = findHarnessTokenLeaks(content);
    expect(leaks).toEqual([
      'Workflow tool@C1 is the `Workflow tool` fan-out primitive with `parallel(` batches.',
      'parallel(@C1 is the `Workflow tool` fan-out primitive with `parallel(` batches.',
    ]);
  });

  test('returns [] when the appendix marker is absent but no leak tokens appear anywhere', () => {
    const content = '# Title\n\nHarness-neutral prose with no per-harness tool tokens.';
    expect(findHarnessTokenLeaks(content)).toEqual([]);
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
