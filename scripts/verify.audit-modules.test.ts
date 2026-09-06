import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import {
  AUDIT_MODULE_DIR,
  documentedCodes,
  findAuditModuleCountDrift,
  findAuditRegistryDrift,
  loadAuditModules,
  parseAuditModuleVcodes,
  reviewerSitedCodes,
  runChecks,
} from './checks/audit-modules.check.ts';
import { REVIEWER_AUDIT_MODULE_COUNT } from './lib/build/facts.ts';

// ADR-034 / V-AUDIT-01. Every leg below is driven first with a registry that is deliberately
// broken (red) and then with the corresponding healthy shape (green), so the check demonstrates
// it can fail on its own inputs rather than only ever being observed passing (V-UNFALSIFIABLE-01).
// The environment each leg names is the live pair the check reads in production: the audit-module
// directory's `vcodes:` frontmatter and `blackhole-vcodes.md`'s enforcement-site column.

const mod = (file: string, vcodes: string[]) => ({ file, vcodes });

const TABLE = [
  '| Code | Rule | Severity | Primary enforcement site |',
  '|------|------|----------|--------------------------|',
  '| V-ALPHA-01 | Alpha rule | BLOCK | reviewer.md § Alpha Audit |',
  '| V-BETA-01/02 | Beta rule | WARN | reviewer.md § Beta Audit |',
  '| V-GAMMA-01 | Gamma rule | BLOCK | implementer.md § Gamma Gate + reviewer.md § Gamma Backstop |',
  '| V-DELTA-01 | Delta rule | WARN | scripts/checks/delta.check.ts |',
].join('\n');

describe('parseAuditModuleVcodes', () => {
  test('reads a YAML flow sequence out of module frontmatter', () => {
    const content = '---\nsection: Alpha Audit\nvcodes: [V-ALPHA-01, V-BETA-01]\n---\n### Alpha Audit\nbody\n';
    expect(parseAuditModuleVcodes(content)).toEqual(['V-ALPHA-01', 'V-BETA-01']);
  });

  test('an empty list and an absent key both yield no claimed codes', () => {
    expect(parseAuditModuleVcodes('---\nsection: Empty\nvcodes: []\n---\nbody\n')).toEqual([]);
    expect(parseAuditModuleVcodes('### No frontmatter at all\nbody\n')).toEqual([]);
  });
});

describe('reviewerSitedCodes / documentedCodes', () => {
  test('reviewer-sited selection expands combined keys and keeps compound sites', () => {
    expect(reviewerSitedCodes(TABLE)).toEqual(['V-ALPHA-01', 'V-BETA-01', 'V-BETA-02', 'V-GAMMA-01']);
  });

  test('documented set spans every row, reviewer-sited or not', () => {
    expect(documentedCodes(TABLE)).toContain('V-DELTA-01');
  });
});

describe('findAuditRegistryDrift (legs A and B)', () => {
  const sited = reviewerSitedCodes(TABLE);
  const table = documentedCodes(TABLE);
  const healthy = [mod('01-alpha.md', ['V-ALPHA-01']), mod('02-beta.md', ['V-BETA-01', 'V-BETA-02', 'V-GAMMA-01'])];

  test('red — a reviewer-sited code no module claims is reported by name', () => {
    const errors = findAuditRegistryDrift([mod('01-alpha.md', ['V-ALPHA-01'])], sited, table);
    expect(errors.some((e) => e.startsWith('V-GAMMA-01') && e.includes('claimed by no audit module'))).toBe(true);
  });

  test('red — a code claimed by two modules names both files', () => {
    const errors = findAuditRegistryDrift(
      [mod('01-alpha.md', ['V-ALPHA-01']), mod('02-beta.md', ['V-ALPHA-01', 'V-BETA-01', 'V-BETA-02', 'V-GAMMA-01'])],
      sited,
      table,
    );
    const contested = errors.find((e) => e.startsWith('V-ALPHA-01'));
    expect(contested).toContain('01-alpha.md');
    expect(contested).toContain('02-beta.md');
  });

  test('red — a claimed code with no table row is reported as absent from the table', () => {
    const errors = findAuditRegistryDrift([...healthy, mod('03-ghost.md', ['V-GHOST-99'])], sited, table);
    expect(errors.some((e) => e.startsWith('V-GHOST-99') && e.includes('absent from the V-code table'))).toBe(true);
  });

  test('red — an empty registry reports every reviewer-sited code rather than passing vacuously', () => {
    expect(findAuditRegistryDrift([], sited, table)).toHaveLength(sited.length);
  });

  test('green — exactly-once ownership of every reviewer-sited code passes', () => {
    expect(findAuditRegistryDrift(healthy, sited, table)).toEqual([]);
  });
});

describe('findAuditModuleCountDrift (leg C)', () => {
  test('red — a declared count above the directory count names both numbers', () => {
    const errors = findAuditModuleCountDrift(32, 31);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('32');
    expect(errors[0]).toContain('31');
    expect(errors[0]).toContain(AUDIT_MODULE_DIR);
  });

  test('red — a missing or empty module directory scans to zero and fails loudly', () => {
    expect(loadAuditModules(path.join(root, 'src/references/no-such-audits'))).toEqual([]);
    expect(findAuditModuleCountDrift(REVIEWER_AUDIT_MODULE_COUNT, 0)).toHaveLength(1);
  });

  test('green — matching counts pass', () => {
    expect(findAuditModuleCountDrift(32, 32)).toEqual([]);
  });
});

describe('runChecks live tree (V-AUDIT-01)', () => {
  test('every audit module on disk declares a non-empty vcodes list or an explicit empty one', () => {
    const modules = loadAuditModules(path.join(root, AUDIT_MODULE_DIR));
    expect(modules.length).toBe(REVIEWER_AUDIT_MODULE_COUNT);
    for (const m of modules) {
      const content = fs.readFileSync(path.join(root, AUDIT_MODULE_DIR, m.file), 'utf-8');
      expect(content.includes('\nvcodes:'), `${m.file} has no vcodes: frontmatter key`).toBe(true);
    }
  });

  test('passes against the live reviewer audit-module registry', () => {
    const results = runChecks();
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('V-AUDIT-01');
    expect(results[0].ok, results[0].detail).toBe(true);
  });
});
