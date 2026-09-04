import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Structural regression for issue #458: locks the attack-signature reference shape so the
// compact CWE/pattern table cannot silently shrink between releases.

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');
const filePath = 'src/references/security-attack-signatures.md';
const content = read(filePath);

const REQUIRED_HEADINGS = [
  '## Injection',
  '## Broken access control / IDOR',
  '## Permissive CORS',
  '## Weak cryptography',
  '## Unsafe deserialization',
  '## SSRF',
] as const;

const REQUIRED_CWES = [
  'CWE-89',
  'CWE-943',
  'CWE-78',
  'CWE-1336',
  'CWE-639',
  'CWE-285',
  'CWE-942',
  'CWE-328',
  'CWE-256',
  'CWE-502',
  'CWE-918',
] as const;

describe('src/references/security-attack-signatures.md — issue #458 shape', () => {
  test('file exists', () => {
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);
  });

  test('scope note references V-SEC-06 exploitability gate', () => {
    expect(content).toContain('V-SEC-06');
    expect(content).toMatch(/diff-scoped|changed lines/i);
  });

  test('all six category headings are present', () => {
    for (const heading of REQUIRED_HEADINGS) {
      expect(content).toContain(heading);
    }
  });

  test('minimum CWE set is present', () => {
    for (const cwe of REQUIRED_CWES) {
      expect(content).toContain(cwe);
    }
  });

  test('each category section has a populated table row', () => {
    for (const heading of REQUIRED_HEADINGS) {
      const sectionMatch = content.match(
        new RegExp(`${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n([\\s\\S]*?)(?=\\n## |$)`),
      );
      expect(sectionMatch).not.toBeNull();
      const section = sectionMatch![1];
      expect(section).toMatch(/\| CWE \| Search pattern \| Exploitable when \|/);
      const dataRows = section
        .split('\n')
        .filter((line) => line.startsWith('| CWE-'));
      expect(dataRows.length).toBeGreaterThanOrEqual(1);
      for (const row of dataRows) {
        const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
        expect(cells.length).toBeGreaterThanOrEqual(3);
        expect(cells[0]).toMatch(/^CWE-\d+$/);
        expect(cells[1].length).toBeGreaterThan(0);
        expect(cells[2].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('security-mode wiring cites the reference file', () => {
  test('review-core.md cites security-attack-signatures.md at least twice', () => {
    const reviewCore = fs.readFileSync(path.join(root, 'src/references/review-core.md'), 'utf-8');
    const matches = reviewCore.match(/security-attack-signatures\.md/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(reviewCore).not.toContain('not a vendored import');
  });

  test('reviewer.md § Security Checks cites security-attack-signatures.md once', () => {
    const securityChecks = read('src/references/audits/04-security-checks.md');
    const matches = securityChecks.match(/security-attack-signatures\.md/g) ?? [];
    expect(matches.length).toBe(1);
    expect(securityChecks).toContain('V-SEC-06');
  });
});
