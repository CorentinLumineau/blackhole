import { describe, expect, test } from 'bun:test';
import {
  evaluateCheckpointAlignment,
  extractCheckpointTemplateKeys,
  runChecks,
} from './checks/checkpoint.check.ts';

const FIXTURE = `
## Checkpoint template

\`\`\`markdown
---
refreshed_at: 2026-07-05T00:00:00.000Z
orchestrator_turn_id: 12
last_completed_phase: review
---

# Campaign Checkpoint
\`\`\`
`;

const VALID_ORCHESTRATOR = `
See checkpoint-protocol.md for the template.
orchestrator_turn_id is written each turn.
Write order: queue.json → findings-ledger.json → campaign-checkpoint.md
`;

const VALID_PHASE_LOOP = `
See checkpoint-protocol.md for alignment.
Write order: queue.json → findings-ledger.json → campaign-checkpoint.md
`;

describe('extractCheckpointTemplateKeys', () => {
  test('extracts required YAML frontmatter keys from fenced template', () => {
    const keys = extractCheckpointTemplateKeys(FIXTURE);
    expect(keys).toEqual(['refreshed_at', 'orchestrator_turn_id', 'last_completed_phase']);
  });

  test('returns empty when template block has no frontmatter keys', () => {
    const keys = extractCheckpointTemplateKeys('```markdown\n# no frontmatter\n```');
    expect(keys).toEqual([]);
  });
});

describe('evaluateCheckpointAlignment', () => {
  test('passes when all three strings satisfy every branch', () => {
    const result = evaluateCheckpointAlignment(FIXTURE, VALID_ORCHESTRATOR, VALID_PHASE_LOOP);
    expect(result).toEqual({ id: 'V-CHECKPOINT-01', ok: true });
  });

  test('fails when protocol template omits refreshed_at', () => {
    const protocol = FIXTURE.replace('refreshed_at:', 'refreshed:');
    const result = evaluateCheckpointAlignment(protocol, VALID_ORCHESTRATOR, VALID_PHASE_LOOP);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('checkpoint-protocol.md template missing refreshed_at');
  });

  test('fails when orchestrator omits checkpoint-protocol.md reference', () => {
    const orchestrator = VALID_ORCHESTRATOR.replace('checkpoint-protocol.md', 'checkpoint-protocol');
    const result = evaluateCheckpointAlignment(FIXTURE, orchestrator, VALID_PHASE_LOOP);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('orchestrator.md missing checkpoint-protocol.md reference');
  });

  test('fails when orchestrator omits orchestrator_turn_id', () => {
    const orchestrator = VALID_ORCHESTRATOR.replace('orchestrator_turn_id', 'turn_id');
    const result = evaluateCheckpointAlignment(FIXTURE, orchestrator, VALID_PHASE_LOOP);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('orchestrator.md missing orchestrator_turn_id');
  });

  test('fails when orchestrator omits ordered write sequence', () => {
    const orchestrator = VALID_ORCHESTRATOR.replace(
      'queue.json → findings-ledger.json → campaign-checkpoint.md',
      'queue.json, findings-ledger.json, campaign-checkpoint.md'
    );
    const result = evaluateCheckpointAlignment(FIXTURE, orchestrator, VALID_PHASE_LOOP);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain(
      'orchestrator.md missing ordered queue.json → findings-ledger.json → campaign-checkpoint.md'
    );
  });

  test('fails when phase-loop omits ordered write sequence', () => {
    const phaseLoop = VALID_PHASE_LOOP.replace(
      'queue.json → findings-ledger.json → campaign-checkpoint.md',
      'queue.json then findings-ledger.json then campaign-checkpoint.md'
    );
    const result = evaluateCheckpointAlignment(FIXTURE, VALID_ORCHESTRATOR, phaseLoop);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain(
      'phase-loop.md missing ordered queue.json → findings-ledger.json → campaign-checkpoint.md'
    );
  });

  test('fails when phase-loop omits checkpoint-protocol.md reference', () => {
    const phaseLoop = VALID_PHASE_LOOP.replace('checkpoint-protocol.md', 'checkpoint-protocol');
    const result = evaluateCheckpointAlignment(FIXTURE, VALID_ORCHESTRATOR, phaseLoop);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('phase-loop.md missing checkpoint-protocol.md reference');
  });
});

describe('checkpoint runChecks() against the real src/ files', () => {
  test('returns exactly one V-CHECKPOINT-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-CHECKPOINT-01');
  });

  test('passes against the current tree — checkpoint protocol is aligned across entry paths', () => {
    const [result] = runChecks();
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});
