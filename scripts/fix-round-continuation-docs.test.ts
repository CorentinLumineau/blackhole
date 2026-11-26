import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTINUATION_MAX_TRANSCRIPT_BYTES, WARM_TTL_MS } from './lib/worker-context-report.ts';

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

  test('the size cap and the complete-return condition in prose match the constant', () => {
    expect(CONTINUATION_MAX_TRANSCRIPT_BYTES).toBe(600_000);
    expect(section()).toContain(`at most ${CONTINUATION_MAX_TRANSCRIPT_BYTES} bytes`);
    expect(section()).toContain('CONTINUATION_MAX_TRANSCRIPT_BYTES');
    expect(section()).toContain('`status: complete`');
  });

  test('both continuation paths carry Failed-Approaches and unevaluable conditions fall back to fresh', () => {
    const s = section();
    expect(s.match(/Failed-Approaches entries/g)?.length).toBeGreaterThanOrEqual(2);
    expect(s).toContain('Lean means no previous transcript, not a reduced contract');
    expect(s).toContain('cannot be evaluated counts as false');
    expect(s).toContain('`CLAUDE_CODE_SESSION_ID` unset');
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
