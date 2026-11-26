import { describe, expect, test } from 'bun:test';
import { requiredAuditModules } from './audit-module-triggers.ts';
import { kaizenRow } from './campaign-status/launch-summary.ts';
import { buildConfigRows } from './campaign-status/overview.ts';
import { writeGovernanceActive, type DocsGovernanceConfig } from './merge-gate/review-artifact.ts';

// Every consumer of the docs_governance write gate must agree with `writeGovernanceActive` on
// every config shape: absent block, `enabled` not the literal true, write_governance unset/true/false.
const CASES: Array<{ name: string; config: DocsGovernanceConfig | undefined; expected: boolean }> = [
  { name: 'absent block', config: undefined, expected: false },
  { name: 'empty block', config: {}, expected: false },
  { name: 'enabled false', config: { enabled: false }, expected: false },
  { name: 'enabled false, write_governance true', config: { enabled: false, write_governance: true }, expected: false },
  { name: 'enabled non-boolean', config: { enabled: 'true' as unknown as boolean }, expected: false },
  { name: 'enabled true, write_governance unset', config: { enabled: true }, expected: true },
  { name: 'enabled true, write_governance true', config: { enabled: true, write_governance: true }, expected: true },
  { name: 'enabled true, write_governance false', config: { enabled: true, write_governance: false }, expected: false },
];

describe('docs_governance write gate: one truth table across consumers', () => {
  for (const { name, config, expected } of CASES) {
    test(`${name} -> ${expected}`, () => {
      expect(writeGovernanceActive(config)).toBe(expected);

      const audit = requiredAuditModules({ changedFiles: ['documentation/x.md'], config: { docs_governance: config } });
      expect(audit.includes('25-staged-artifact-carry-audit.md')).toBe(expected);
      expect(audit.includes('27-doc-governance-judgment-audit.md')).toBe(expected);

      const kaizen = kaizenRow({ docs_governance: config } as Parameters<typeof kaizenRow>[0]);
      expect(kaizen.value).toContain(`staging carry ${expected ? 'on' : 'off'}`);

      const docsRow = buildConfigRows({ docs_governance: config } as Parameters<typeof buildConfigRows>[0], null).find(
        (r) => r.key === 'Docs governance',
      );
      expect(docsRow?.value).toBe(config?.enabled === true ? `on · staging carry ${expected ? 'on' : 'off'}` : 'off');
    });
  }
});
