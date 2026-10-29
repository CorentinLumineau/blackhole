import type { CheckpointMeta } from './types.ts';

export function parseCheckpointFrontmatter(content: string): CheckpointMeta {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const meta: CheckpointMeta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === 'orchestrator_turn_id') meta.orchestrator_turn_id = Number(val);
    else if (key === 'last_completed_phase') meta.last_completed_phase = val;
    else if (key === 'refreshed_at') meta.refreshed_at = val;
  }
  return meta;
}
