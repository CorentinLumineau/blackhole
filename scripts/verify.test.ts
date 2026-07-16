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
  findRosterScanMismatch,
  findRowCountMismatch,
  extractAgentRosterTableNames,
  findReadmeAgentCountMismatch,
  parseSectionLineCounts,
  findContentGateViolations,
  ORCHESTRATOR_CONTENT_GATE_BASELINE,
  CONTENT_GATE_NEW_SECTION_BUDGET_LOC,
  validateRefreshedAtFixture,
  validateGeminiPluginFixture,
  validateCodexPluginFixture,
  validateCodexMarketplaceFixture,
  validateQueueIssuesShape,
  validateConfigFixtureShape,
} from './checks/core.check.ts';
import { codexTreeErrors } from './tree-shape.ts';
import { AGENT_YAML_FILES, AGENT_NAMES } from './build.ts';
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

// V-GROUND-01 (ADR-007 T3/R1′): two-sided facts-conformance — an independent filesystem scan is
// compared against build.ts's § facts declaration, never collapsed onto one derivation (the
// critics' binding rejection of single-source generation, ADR-007 Rejected Alternatives).
describe('findRosterScanMismatch', () => {
  test('returns null when the scanned set and the declared set match regardless of order', () => {
    expect(findRosterScanMismatch(['b.md', 'a.md'], ['a.md', 'b.md'])).toBeNull();
  });

  test('names only the symmetric difference (extra) when a fixture agent file is added without a matching AGENT_NAMES edit', () => {
    const declared = [...AGENT_NAMES].map((n) => `${n}.md`);
    const scanned = [...declared, 'stray-new-agent.md'];
    const mismatch = findRosterScanMismatch(scanned, declared);
    expect(mismatch).toBe('extra [stray-new-agent.md]');
  });

  test('names only the symmetric difference (missing) when a declared agent file is removed from disk', () => {
    const declared = [...AGENT_NAMES].map((n) => `${n}.md`);
    const scanned = declared.slice(1); // first agent's file missing from the scan
    const mismatch = findRosterScanMismatch(scanned, declared);
    expect(mismatch).toBe(`missing [${declared[0]}]`);
  });
});

describe('findRowCountMismatch', () => {
  test('returns null when declared count equals actual count', () => {
    expect(findRowCountMismatch('vcode table rows', 43, 43)).toBeNull();
  });

  test('names the label, declared count, and actual count on mismatch', () => {
    expect(findRowCountMismatch('vcode table rows', 43, 44)).toBe(
      'vcode table rows: declared 43, found 44',
    );
  });
});

// V-DOCTABLE-01 (ADR-007 T3/R1′): AGENTS.md's roster table and README.md's agent-count mention
// are hand-authored — checked against the build.ts declaration with a tolerant row-set parser,
// never generated/clobbered (ADR-007 Rejected Alternatives: no generation-in-place).
describe('extractAgentRosterTableNames', () => {
  test('extracts backtick-quoted names from the Agent roster table, tolerant of surrounding prose', () => {
    const content = [
      '# Blackhole',
      '',
      'Some intro prose that mentions `coordinator` in passing (must not be picked up).',
      '',
      '## Agent roster',
      '',
      '| Agent | Role | Trigger |',
      '|-------|------|---------|',
      '| `coordinator` | User intake | Multitask Mode entry |',
      '| `orchestrator` | Five-phase loop | Spawned by coordinator |',
      '',
      '## Installation',
      '',
      'Prose mentioning `orchestrator` again here must not be picked up.',
    ].join('\n');

    expect(extractAgentRosterTableNames(content)).toEqual(['coordinator', 'orchestrator']);
  });

  test('a deliberately-stale AGENTS.md fixture (one roster row missing) fails naming the exact missing row', () => {
    const declared = [...AGENT_NAMES].map((n) => `${n}.md`);
    const staleContent = [
      '## Agent roster',
      '',
      '| Agent | Role | Trigger |',
      '|-------|------|---------|',
      // every agent except the last one — a deliberately-stale fixture roster table
      ...AGENT_NAMES.slice(0, -1).map((n) => `| \`${n}\` | role | trigger |`),
    ].join('\n');

    const found = extractAgentRosterTableNames(staleContent).map((n) => `${n}.md`);
    const mismatch = findRosterScanMismatch(found, declared);
    expect(mismatch).not.toBeNull();
    expect(mismatch).toContain(`${AGENT_NAMES[AGENT_NAMES.length - 1]}.md`);
  });
});

describe('findReadmeAgentCountMismatch', () => {
  test('returns null when the README mentions "<count> agent prompts"', () => {
    const readme = 'Compiles `.agents/build/` (workspace customization — 8 agent prompts, rules, skills)';
    expect(findReadmeAgentCountMismatch(readme, 8)).toBeNull();
  });

  test('names the expected count when the README mentions a stale count', () => {
    const readme = 'Compiles `.agents/build/` (workspace customization — 7 agent prompts, rules, skills)';
    const mismatch = findReadmeAgentCountMismatch(readme, 8);
    expect(mismatch).not.toBeNull();
    expect(mismatch).toContain('8 agent prompts');
  });

  test('names the expected count when the README has no agent-count mention at all', () => {
    const mismatch = findReadmeAgentCountMismatch('no such mention here', 8);
    expect(mismatch).toContain('8 agent prompts');
  });
});

// V-CONTENTGATE-01 (ADR-007 T6/R3′): section-budget content-gate for orchestrator.md. Inline
// fixtures cover the parser and the grow-never/new-section-budget decision logic; a final live
// integration case runs the same pure functions against the real orchestrator.md content to
// confirm zero false positives (T6 acceptance criterion 1).
describe('parseSectionLineCounts', () => {
  test('ignores ## headings inside fenced code blocks (fence-aware)', () => {
    const content = [
      '## Real Section',
      'text',
      '```',
      '## Not A Heading',
      '```',
      'more text',
      '## Second Section',
      'body',
    ].join('\n');
    const counts = parseSectionLineCounts(content);
    expect(Object.keys(counts)).toEqual(['## Real Section', '## Second Section']);
    expect(counts['## Real Section']).toBe(6);
  });

  test('maps each `##` header to its line count, up to the next `##` header', () => {
    const content = ['## First', 'a', 'b', '## Second', 'c'].join('\n');
    expect(parseSectionLineCounts(content)).toEqual({
      '## First': 3,
      '## Second': 2,
    });
  });

  test('extends the last section to end of content and drops a trailing empty split element', () => {
    const content = '## Only\nline one\nline two\n';
    expect(parseSectionLineCounts(content)).toEqual({ '## Only': 3 });
  });

  test('does not treat a `###` subsection as its own `##`-level boundary', () => {
    const content = ['## Parent', '### Child', 'body', '## Next'].join('\n');
    expect(parseSectionLineCounts(content)).toEqual({
      '## Parent': 3,
      '## Next': 1,
    });
  });

  test('returns {} for content with no `##` headers', () => {
    expect(parseSectionLineCounts('no headers here\njust prose')).toEqual({});
  });
});

describe('findContentGateViolations', () => {
  test('passes a baseline-grandfathered section at its recorded baseline size', () => {
    const sections = { '## Route-derived dispatch': 110 };
    const baseline = { '## Route-derived dispatch': 110 };
    expect(findContentGateViolations(sections, baseline, 50)).toEqual([]);
  });

  test('passes a baseline section that has shrunk below its recorded baseline', () => {
    const sections = { '## Route-derived dispatch': 90 };
    const baseline = { '## Route-derived dispatch': 110 };
    expect(findContentGateViolations(sections, baseline, 50)).toEqual([]);
  });

  test('fails a baseline section that grew past its recorded baseline (grow-never)', () => {
    const sections = { '## Route-derived dispatch': 111 };
    const baseline = { '## Route-derived dispatch': 110 };
    const violations = findContentGateViolations(sections, baseline, 50);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('## Route-derived dispatch');
    expect(violations[0]).toContain('111 LOC');
    expect(violations[0]).toContain('grandfathered baseline of 110 LOC');
  });

  test('passes a new (non-baseline) section at or under the budget', () => {
    const sections = { '## New Thin Pointer': 50 };
    expect(findContentGateViolations(sections, {}, 50)).toEqual([]);
  });

  test('fails a new section exceeding the budget, naming the header and its line count', () => {
    const sections = { '## New Sprawling Section': 51 };
    const violations = findContentGateViolations(sections, {}, 50);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('## New Sprawling Section');
    expect(violations[0]).toContain('51 LOC');
    expect(violations[0]).toContain('50-LOC budget');
  });
});

describe('checkContentGate integration (real orchestrator.md, zero false positives)', () => {
  test('every current orchestrator.md `##` section is grandfathered in the baseline and passes', () => {
    const orchestratorMd = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'src', 'agents', 'orchestrator.md'),
      'utf-8',
    );
    const sections = parseSectionLineCounts(orchestratorMd);
    const violations = findContentGateViolations(
      sections,
      ORCHESTRATOR_CONTENT_GATE_BASELINE,
      CONTENT_GATE_NEW_SECTION_BUDGET_LOC,
    );
    expect(violations).toEqual([]);
    // Sections not in the grandfathered baseline are legitimate new (post-T6) additions, budget-
    // checked above via findContentGateViolations rather than forbidden outright — ADR-010 M2's
    // "## Design Autonomy Dispatch" is the first such addition. Assert the non-baseline set is
    // exactly the expected new-section allowlist, so an unexpected/undocumented new `##` header
    // still fails loudly here even though it would pass the budget check above.
    const nonBaselineSections = Object.keys(sections).filter((h) => !(h in ORCHESTRATOR_CONTENT_GATE_BASELINE));
    expect(nonBaselineSections).toEqual(['## Design Autonomy Dispatch (ADR-010 D4)']);
  });
});

// V-SCHEMA-01 (#279): checkFixtures' per-fixture-type shape validators, extracted from the
// previously-untested inline branching so each rejects a deliberately malformed fixture and
// accepts a valid one — not mere existence checks.
describe('validateRefreshedAtFixture', () => {
  test('accepts a fixture with refreshed_at present', () => {
    expect(
      validateRefreshedAtFixture('fixtures/queue.example.json', { refreshed_at: '2026-01-01T00:00:00Z' }),
    ).toEqual([]);
  });

  test('rejects a fixture missing refreshed_at', () => {
    expect(validateRefreshedAtFixture('fixtures/queue.example.json', {})).toEqual([
      'fixtures/queue.example.json: missing refreshed_at',
    ]);
  });
});

describe('validateGeminiPluginFixture', () => {
  test('accepts a fixture with $schema/name/version/description all present', () => {
    const data = { $schema: 'https://example.com/schema.json', name: 'blackhole', version: '1.0.0', description: 'desc' };
    expect(validateGeminiPluginFixture('fixtures/gemini-plugin.example.json', data)).toEqual([]);
  });

  test('rejects a fixture missing required keys, naming each one', () => {
    const data = { name: 'blackhole' };
    expect(validateGeminiPluginFixture('fixtures/gemini-plugin.example.json', data)).toEqual([
      'fixtures/gemini-plugin.example.json: missing $schema',
      'fixtures/gemini-plugin.example.json: missing version',
      'fixtures/gemini-plugin.example.json: missing description',
    ]);
  });
});

describe('validateCodexPluginFixture', () => {
  test('accepts a fixture with name/interface/skills and interface.displayName present', () => {
    const data = { name: 'blackhole', interface: { displayName: 'Blackhole' }, skills: './codex-skills/' };
    expect(validateCodexPluginFixture('fixtures/codex-plugin.example.json', data)).toEqual([]);
  });

  test('rejects a fixture missing top-level keys and interface.displayName', () => {
    const data = { interface: {} };
    expect(validateCodexPluginFixture('fixtures/codex-plugin.example.json', data)).toEqual([
      'fixtures/codex-plugin.example.json: missing name',
      'fixtures/codex-plugin.example.json: missing skills',
      'fixtures/codex-plugin.example.json: interface missing displayName',
    ]);
  });
});

describe('validateCodexMarketplaceFixture', () => {
  test('accepts a fixture whose plugins[0].source.source is git', () => {
    const data = { plugins: [{ source: { source: 'git' } }] };
    expect(validateCodexMarketplaceFixture('fixtures/codex-marketplace.example.json', data)).toEqual([]);
  });

  test('rejects a fixture with a non-git source', () => {
    const data = { plugins: [{ source: { source: 'npm' } }] };
    expect(validateCodexMarketplaceFixture('fixtures/codex-marketplace.example.json', data)).toEqual([
      'fixtures/codex-marketplace.example.json: plugins[0].source.source must be git',
    ]);
  });

  test('rejects a fixture with no plugins[0].source.source at all (both checks fire — missing is also not "git")', () => {
    const data = { plugins: [{}] };
    expect(validateCodexMarketplaceFixture('fixtures/codex-marketplace.example.json', data)).toEqual([
      'fixtures/codex-marketplace.example.json: plugins[0].source.source missing',
      'fixtures/codex-marketplace.example.json: plugins[0].source.source must be git',
    ]);
  });
});

describe('validateQueueIssuesShape', () => {
  test('accepts a queue where every issue has a numeric review_iteration', () => {
    const queue = { issues: { '1': { review_iteration: 0 }, '2': { review_iteration: 2 } } };
    expect(validateQueueIssuesShape(queue)).toEqual([]);
  });

  test('rejects a queue with no issues object', () => {
    expect(validateQueueIssuesShape({})).toEqual(['queue.example.json: missing issues object']);
  });

  test('rejects a queue whose issue is missing review_iteration', () => {
    const queue = { issues: { '1': { phase: 'plan' } } };
    expect(validateQueueIssuesShape(queue)).toEqual(['queue.example.json: issue missing review_iteration']);
  });
});

describe('validateConfigFixtureShape', () => {
  test('accepts a config with required string keys and valid optional fields', () => {
    const config = {
      repo: 'CorentinLumineau/blackhole',
      target_branch: 'main',
      forge: 'github',
      scope_milestone: 'v0.4.0',
      scope_labels: ['blackhole/backlog'],
    };
    expect(validateConfigFixtureShape(config)).toEqual([]);
  });

  test('rejects a config missing required keys and with invalid optional field types', () => {
    const config = { repo: 'owner/repo-name', scope_milestone: 42, scope_labels: ['ok', 7] };
    expect(validateConfigFixtureShape(config)).toEqual([
      'config.example.json: missing or invalid target_branch',
      'config.example.json: missing or invalid forge',
      'config.example.json: scope_milestone must be a string',
      'config.example.json: scope_labels must be a string array',
    ]);
  });
});
