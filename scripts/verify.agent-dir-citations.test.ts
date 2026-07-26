import { describe, expect, test } from 'bun:test';
import {
  extractAgentDirCitations,
  findCitationViolations,
} from './checks/agent-dir-citations.check.ts';

describe('extractAgentDirCitations', () => {
  test('extracts backtick-wrapped and plain citations', () => {
    const content = `
Binding: \`.cursor/skills/blackhole/references/multitask-mode.md\`.
see skills/blackhole/references/foo.md for details
`;
    expect(extractAgentDirCitations(content).sort()).toEqual([
      '.cursor/skills/blackhole/references/multitask-mode.md',
      'skills/blackhole/references/foo.md',
    ]);
  });

  test('strips trailing punctuation from captured paths', () => {
    const content = "per `.cursor/skills/blackhole/references/confidence-gates.md`'s gate";
    expect(extractAgentDirCitations(content)).toEqual([
      '.cursor/skills/blackhole/references/confidence-gates.md',
    ]);
  });
});

describe('findCitationViolations', () => {
  test('flags forbidden .cursor/ prefix on flat-root target', () => {
    const content = 'Binding: `.cursor/skills/blackhole/references/foo.md`.';
    const violations = findCitationViolations(
      content,
      'agents/coordinator.md',
      'skills/blackhole/',
      ['.cursor/skills/blackhole/']
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('forbidden prefix');
  });

  test('accepts skills/blackhole/ prefix when path exists', () => {
    const content = 'Binding: `skills/blackhole/references/multitask-mode.md`.';
    const violations = findCitationViolations(
      content,
      'agents/coordinator.md',
      'skills/blackhole/',
      ['.cursor/skills/blackhole/']
    );
    expect(violations).toEqual([]);
  });

  test('flags wrong prefix even when file exists elsewhere', () => {
    const content = 'Binding: `.cursor/skills/blackhole/references/multitask-mode.md`.';
    const violations = findCitationViolations(
      content,
      'agents/coordinator.md',
      'skills/blackhole/',
      []
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('expected prefix');
  });
});
