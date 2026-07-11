import { describe, expect, test } from 'bun:test';
import { extractCheckpointTemplateKeys } from './checks/checkpoint.check.ts';

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
