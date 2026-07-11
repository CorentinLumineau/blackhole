import * as fs from 'fs';
import * as path from 'path';

// ADR-007 T5/R2' — checkpoint.check.ts: matches verify.checkpoint.test.ts.

const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

// V-CHECKPOINT-01: checkpoint-protocol template ↔ orchestrator/phase-loop alignment
export const extractCheckpointTemplateKeys = (content: string): string[] => {
  const templateMatch = content.match(/## Checkpoint template[\s\S]*?```markdown\n([\s\S]*?)```/);
  if (!templateMatch) return [];

  const frontmatterMatch = templateMatch[1].match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return [];

  return frontmatterMatch[1]
    .split('\n')
    .map((line) => line.match(/^([\w_]+):/)?.[1])
    .filter((key): key is string => Boolean(key));
};

const checkCheckpointAlignment = (): CheckResult => {
  const requiredKeys = ['refreshed_at', 'orchestrator_turn_id', 'last_completed_phase'];
  const protocol = read('src/references/checkpoint-protocol.md');
  const orchestrator = read('src/agents/orchestrator.md');
  const phaseLoop = read('src/references/phase-loop.md');
  const errors: string[] = [];

  const templateKeys = extractCheckpointTemplateKeys(protocol);
  for (const key of requiredKeys) {
    if (!templateKeys.includes(key)) errors.push(`checkpoint-protocol.md template missing ${key}`);
  }

  if (!orchestrator.includes('checkpoint-protocol.md')) {
    errors.push('orchestrator.md missing checkpoint-protocol.md reference');
  }
  if (!orchestrator.includes('orchestrator_turn_id')) {
    errors.push('orchestrator.md missing orchestrator_turn_id');
  }
  const writeOrder =
    orchestrator.includes('queue.json') &&
    orchestrator.includes('findings-ledger.json') &&
    orchestrator.includes('campaign-checkpoint.md');
  const orderedWrite =
    /queue\.json\s*→\s*findings-ledger\.json\s*→\s*campaign-checkpoint\.md/.test(orchestrator);
  if (!writeOrder || !orderedWrite) {
    errors.push('orchestrator.md missing ordered queue.json → findings-ledger.json → campaign-checkpoint.md');
  }

  const phaseWriteOrder =
    /queue\.json\s*→\s*findings-ledger\.json\s*→\s*campaign-checkpoint\.md/.test(phaseLoop);
  if (!phaseWriteOrder) {
    errors.push('phase-loop.md missing ordered queue.json → findings-ledger.json → campaign-checkpoint.md');
  }
  if (!phaseLoop.includes('checkpoint-protocol.md')) {
    errors.push('phase-loop.md missing checkpoint-protocol.md reference');
  }

  if (errors.length) return { id: 'V-CHECKPOINT-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-CHECKPOINT-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see core.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkCheckpointAlignment()];
