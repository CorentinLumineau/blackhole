import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const ref = (name: string): string => readFileSync(new URL(`../src/references/${name}`, import.meta.url), 'utf8');

describe('lane claim wiring in src/references', () => {
  test('the dispatch section names the CLI, both flags and every verdict', () => {
    const doc = ref('orchestrator-dispatch.md');
    const section = doc.slice(doc.indexOf('## Lane claim and release'));
    expect(section.length).toBeGreaterThan(0);
    for (const word of ['scripts/claim.ts', '--claim', '--release', 'CLAIMED', 'ALREADY-OWN', 'RECLAIMED', 'SKIP', 'HELD', 'CLOSED', 'ADR-053']) {
      expect(section).toContain(word);
    }
  });

  test('the dispatch site, the merge protocol and the stop tiers point at it', () => {
    for (const file of ['orchestrator-delegation.md', 'phase-loop.md', 'phase-stop.md']) {
      expect(ref(file)).toContain('Lane claim');
    }
  });

  test('forge-sync.md states lane-label ownership and the lease', () => {
    const doc = ref('forge-sync.md');
    expect(doc).toContain('own lane label');
    expect(doc).toContain('catchup.claim_lease_hours');
  });

  test('config-template.md no longer defers the lane keys to M4', () => {
    expect(ref('config-template.md')).not.toContain('consumed from M4');
  });

  test('phase-catchup.md tells the owner to set catchup.lane per account', () => {
    expect(ref('phase-catchup.md')).toContain('Set `catchup.lane` per account');
  });
});
