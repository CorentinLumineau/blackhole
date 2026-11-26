import * as fs from 'fs';
import * as path from 'path';
import { loadManifest, validateEntries, type Manifest } from './carry-staged-artifacts.ts';

// The one writer of `.blackhole/staged/<issue>/manifest.json` (blackhole-state.md § Staging).
// Producers (planner, investigator) call this instead of shelling out a redirect, because a
// redirect truncates the target before the new content exists and leaves a zero-byte manifest
// that the carry step then refuses. The candidate is validated before it replaces the live file.

export const appendManifestEntry = (manifestPath: string, issue: number, entry: unknown): Manifest => {
  const { valid, skipped } = validateEntries([entry]);
  if (skipped.length > 0) throw new Error(`${manifestPath}: refused entry: ${skipped[0].reason}`);

  // An existing zero-byte or unparseable manifest throws here: overwriting it would drop the
  // entries prior producers staged.
  const existing = loadManifest(manifestPath);
  if (existing !== null && existing.issue !== issue) {
    throw new Error(`${manifestPath}: manifest is for issue ${String(existing.issue)}, not ${issue}`);
  }

  const next: Manifest = {
    issue,
    updated_at: new Date().toISOString(),
    entries: [...(existing?.entries ?? []), valid[0]],
  };
  const serialized = JSON.stringify(next, null, 2) + '\n';
  JSON.parse(serialized);

  const tmpPath = `${manifestPath}.tmp`;
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  try {
    fs.writeFileSync(tmpPath, serialized);
    fs.renameSync(tmpPath, manifestPath);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
  return next;
};
