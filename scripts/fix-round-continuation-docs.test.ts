import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { WARM_TTL_MS } from './lib/worker-context-report.ts';

const ref = (name: string): string => readFileSync(new URL(`../src/references/${name}`, import.meta.url), 'utf8');
const section = (): string => {
  const doc = ref('orchestrator-delegation.md');
  const start = doc.indexOf('### Fix-round continuation (SendMessage)');
  return start < 0 ? '' : doc.slice(start, doc.indexOf('### Route-derived dispatch', start));
};

describe('fix-round implementer continuation protocol', () => {
  test('the section exists and states every continuation condition', () => {
    const s = section();
    expect(s.length).toBeGreaterThan(0);
    for (const word of ['SendMessage', 'implementer-<issue>', 'Warm', 'Small', 'Same worker shape', 'Clean state', 'Addressable', 'ls-remote', 'fresh spawn', 'lean brief']) {
      expect(s).toContain(word);
    }
  });

  test('the warm window quoted in prose matches the constant the report uses', () => {
    expect(WARM_TTL_MS).toBe(5 * 60_000);
    expect(section()).toContain('within 5 minutes');
    expect(section()).toContain('WARM_TTL_MS');
  });

  test('reviewers, escalation returns and promotion spawns are never continued', () => {
    const s = section();
    const tail = s.slice(s.indexOf('Never continue'));
    expect(s.indexOf('Never continue')).toBeGreaterThan(-1);
    for (const word of ['reviewer', 'escalation_trigger', 'promotion']) expect(tail).toContain(word);
  });

  test('the dispatch sites, the CI path and recovery section 5 point at it', () => {
    for (const file of ['phase-implement.md', 'phase-review.md', 'ci-diagnosis.md', 'recovery-protocol.md']) {
      expect(ref(file)).toContain('Fix-round continuation (SendMessage)');
    }
  });
});
