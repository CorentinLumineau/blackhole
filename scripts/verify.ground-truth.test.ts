import { describe, expect, test } from 'bun:test';
import {
  findRosterScanMismatch,
  findRowCountMismatch,
  extractAgentRosterTableNames,
  findReadmeAgentCountMismatch,
} from './checks/ground-truth.check.ts';
import { AGENT_NAMES } from './build.ts';

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
