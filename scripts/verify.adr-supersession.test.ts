import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  collectDeclaredSupersessionViolations,
  collectPhraseScanViolations,
  extractPhraseScanCitations,
  extractSupersedesAdrDeclaration,
  findDeclaredSupersessionViolations,
  findPhraseScanViolations,
  hasPostAcceptanceAmendmentCitingIssue,
  hasPostAcceptanceAmendmentSection,
  runChecks,
} from './checks/adr-supersession.check.ts';
import { withTempDir } from './lib/test-fixtures.ts';
import { root } from './checks/check-utils.ts';

// V-ADR-06: two legs closing the RC-E self-disclosure gap — an ADR reversal accepted in
// practice but recorded only in a gitignored plan file. Pure extraction/comparison functions are
// tested against synthetic string fixtures (matching verify.vocabulary.test.ts's convention);
// the filesystem-backed collectors use withTempDir (matching adr-status/doc-health's own
// existence-gate and end-to-end coverage).

const AMENDED_ADR = `---
type: adr
status: accepted
---

# ADR-007: Fixture

## References

## Post-acceptance amendments

- 2026-09-02 — #712 reverses R3′, splitting orchestrator.md (accepted, condition: budgeted).
`;

const UNAMENDED_ADR = `---
type: adr
status: accepted
---

# ADR-007: Fixture

## References
`;

describe('extractSupersedesAdrDeclaration', () => {
  test('parses a bracketed ADR list', () => {
    const plan = `---\nissue: #712\nsupersedes_adr: [ADR-007, ADR-009]\n---\n`;
    expect(extractSupersedesAdrDeclaration(plan)).toEqual(['ADR-007', 'ADR-009']);
  });

  test('null value declares nothing', () => {
    const plan = `---\nissue: #712\nsupersedes_adr: null\n---\n`;
    expect(extractSupersedesAdrDeclaration(plan)).toEqual([]);
  });

  test('absent key declares nothing', () => {
    const plan = `---\nissue: #712\n---\n`;
    expect(extractSupersedesAdrDeclaration(plan)).toEqual([]);
  });

  test('single-entry list', () => {
    const plan = `---\nissue: #712\nsupersedes_adr: [ADR-007]\n---\n`;
    expect(extractSupersedesAdrDeclaration(plan)).toEqual(['ADR-007']);
  });
});

describe('hasPostAcceptanceAmendmentSection / hasPostAcceptanceAmendmentCitingIssue', () => {
  test('detects the section', () => {
    expect(hasPostAcceptanceAmendmentSection(AMENDED_ADR)).toBe(true);
    expect(hasPostAcceptanceAmendmentSection(UNAMENDED_ADR)).toBe(false);
  });

  test('citing issue matches when the section names the issue', () => {
    expect(hasPostAcceptanceAmendmentCitingIssue(AMENDED_ADR, '#712')).toBe(true);
    expect(hasPostAcceptanceAmendmentCitingIssue(AMENDED_ADR, '712')).toBe(true);
  });

  test('a section present but citing a different issue does not match', () => {
    expect(hasPostAcceptanceAmendmentCitingIssue(AMENDED_ADR, '#999')).toBe(false);
  });

  test('no section at all does not match', () => {
    expect(hasPostAcceptanceAmendmentCitingIssue(UNAMENDED_ADR, '#712')).toBe(false);
  });
});

describe('findDeclaredSupersessionViolations (leg 1)', () => {
  test('a declared ADR with a matching, issue-citing amendment passes', () => {
    const entries = [{ issueRef: '#712', declaredAdrs: ['ADR-007'] }];
    const adrContents = new Map([['ADR-007', AMENDED_ADR]]);
    expect(findDeclaredSupersessionViolations(entries, adrContents)).toEqual([]);
  });

  test('a declared ADR with no amendments section fails, naming plan and ADR', () => {
    const entries = [{ issueRef: '#712', declaredAdrs: ['ADR-007'] }];
    const adrContents = new Map([['ADR-007', UNAMENDED_ADR]]);
    expect(findDeclaredSupersessionViolations(entries, adrContents)).toEqual([{ issueRef: '#712', adr: 'ADR-007' }]);
  });

  test('a declared ADR whose file could not be resolved fails', () => {
    const entries = [{ issueRef: '#712', declaredAdrs: ['ADR-999'] }];
    const adrContents = new Map<string, string | undefined>([['ADR-999', undefined]]);
    expect(findDeclaredSupersessionViolations(entries, adrContents)).toEqual([{ issueRef: '#712', adr: 'ADR-999' }]);
  });
});

describe('extractPhraseScanCitations (leg 2)', () => {
  test('a prose reversal announcement is captured with its line number', () => {
    const content = 'line one\nintentionally supersedes ADR-007 for reasons\nline three';
    expect(extractPhraseScanCitations(content)).toEqual([{ line: 2, adr: 'ADR-007' }]);
  });

  test('"do not amend ADR-NNN" is captured', () => {
    expect(extractPhraseScanCitations('please do not amend ADR-012 going forward')).toEqual([
      { line: 1, adr: 'ADR-012' },
    ]);
  });

  test('the frontmatter key form `supersedes: <path>` is not captured', () => {
    expect(extractPhraseScanCitations('supersedes: decisions/ADR-009-old.md')).toEqual([]);
  });

  test('a trigger word with no ADR reference on the line is not captured', () => {
    expect(extractPhraseScanCitations('this supersedes the old approach entirely.')).toEqual([]);
  });

  test('the ADR reference must be in the same sentence as the trigger word', () => {
    const content = 'this reverses an old decision. ADR-020 is unrelated to that sentence.';
    expect(extractPhraseScanCitations(content)).toEqual([]);
  });

  test('this check\'s own vcode id is not mistaken for an ADR document reference', () => {
    const content = 'this plan reverses a decision, triggering V-ADR-06 leg 2.';
    expect(extractPhraseScanCitations(content)).toEqual([]);
  });
});

describe('findPhraseScanViolations (leg 2)', () => {
  test('a citation whose ADR has the amendments section passes', () => {
    const citations = [{ relPath: 'src/x.md', line: 5, adr: 'ADR-007' }];
    const adrHasAmendment = new Map([['ADR-007', true]]);
    expect(findPhraseScanViolations(citations, adrHasAmendment)).toEqual([]);
  });

  test('a citation whose ADR lacks the section fails, naming file:line', () => {
    const citations = [{ relPath: 'src/x.md', line: 5, adr: 'ADR-007' }];
    const adrHasAmendment = new Map([['ADR-007', false]]);
    expect(findPhraseScanViolations(citations, adrHasAmendment)).toEqual(citations);
  });
});

describe('collectDeclaredSupersessionViolations (leg 1, filesystem-backed)', () => {
  test('absent .blackhole/plans/ directory is a logged no-op, not a failure', () => {
    withTempDir('adr-supersession-', (dir) => {
      expect(collectDeclaredSupersessionViolations(dir)).toEqual([]);
    });
  });

  test('a declared ADR with a matching amendment produces no violation', () => {
    withTempDir('adr-supersession-', (dir) => {
      fs.mkdirSync(path.join(dir, '.blackhole', 'plans'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'documentation', 'decisions'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.blackhole', 'plans', 'issue-712.md'),
        `---\nissue: #712\nsupersedes_adr: [ADR-007]\n---\n`,
      );
      fs.writeFileSync(path.join(dir, 'documentation', 'decisions', 'ADR-007-fixture.md'), AMENDED_ADR);
      expect(collectDeclaredSupersessionViolations(dir)).toEqual([]);
    });
  });

  test('a declared ADR with no matching amendment produces a violation', () => {
    withTempDir('adr-supersession-', (dir) => {
      fs.mkdirSync(path.join(dir, '.blackhole', 'plans'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'documentation', 'decisions'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.blackhole', 'plans', 'issue-712.md'),
        `---\nissue: #712\nsupersedes_adr: [ADR-007]\n---\n`,
      );
      fs.writeFileSync(path.join(dir, 'documentation', 'decisions', 'ADR-007-fixture.md'), UNAMENDED_ADR);
      expect(collectDeclaredSupersessionViolations(dir)).toEqual([{ issueRef: '#712', adr: 'ADR-007' }]);
    });
  });
});

describe('collectPhraseScanViolations (leg 2, filesystem-backed)', () => {
  test('a tracked file outside documentation/decisions/ with an undisclosed reversal fails', () => {
    withTempDir('adr-supersession-', (dir) => {
      fs.mkdirSync(path.join(dir, 'src', 'references'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'documentation', 'decisions'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src', 'references', 'note.md'),
        'This PR intentionally supersedes ADR-007 without a recorded amendment.',
      );
      fs.writeFileSync(path.join(dir, 'documentation', 'decisions', 'ADR-007-fixture.md'), UNAMENDED_ADR);
      const violations = collectPhraseScanViolations(dir);
      expect(violations).toEqual([{ relPath: 'src/references/note.md', line: 1, adr: 'ADR-007' }]);
    });
  });

  test('the same file passes once the ADR carries the amendments section', () => {
    withTempDir('adr-supersession-', (dir) => {
      fs.mkdirSync(path.join(dir, 'src', 'references'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'documentation', 'decisions'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src', 'references', 'note.md'),
        'This PR intentionally supersedes ADR-007, recorded below.',
      );
      fs.writeFileSync(path.join(dir, 'documentation', 'decisions', 'ADR-007-fixture.md'), AMENDED_ADR);
      expect(collectPhraseScanViolations(dir)).toEqual([]);
    });
  });

  test('documentation/decisions/ files are excluded even when they contain the phrase', () => {
    withTempDir('adr-supersession-', (dir) => {
      fs.mkdirSync(path.join(dir, 'documentation', 'decisions'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'documentation', 'decisions', 'ADR-007-fixture.md'),
        'ADR-007 intentionally supersedes ADR-003 in this very file.',
      );
      expect(collectPhraseScanViolations(dir)).toEqual([]);
    });
  });
});

describe('checkAdrSupersession / runChecks (V-ADR-06, live tree)', () => {
  test('the live repo tree passes both legs', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-ADR-06');
    expect(results[0].ok).toBe(true);
  });

  // Risk 6 (plan § Execution Strategy) — the new blackhole-vcodes.md V-ADR-06 row describes the
  // check's own trigger phrases; guard against it self-triggering leg 2.
  test('blackhole-vcodes.md is scanned and produces no self-triggering citation', () => {
    const content = fs.readFileSync(path.join(root, 'src', 'references', 'blackhole-vcodes.md'), 'utf-8');
    expect(extractPhraseScanCitations(content)).toEqual([]);
  });
});
