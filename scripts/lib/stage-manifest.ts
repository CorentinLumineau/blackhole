import * as fs from 'fs';
import * as path from 'path';
import { loadManifest, validateEntries, type Manifest } from './carry-staged-artifacts.ts';

/**
 * Append one validated entry to `.blackhole/staged/<issue>/manifest.json` via `.tmp` + rename,
 * creating the manifest when absent. Rationale: blackhole-state.md § Staging.
 *
 * @throws when the entry fails validation, when an existing manifest is zero-byte or
 * unparseable, or when the existing manifest belongs to a different issue. The live file is
 * left untouched in every throwing case.
 */
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
