import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import type { HookEvent } from '../hook-event-triage.ts';
import type { DenyCount } from './types.ts';

/** How many rules the dashboard and the page list. */
export const DENY_COUNTS_TOP = 5;

// Triage archives every event it ingests into `archive/hook-events-<ts>/`, and the hook's rotation
// sweep into `archive/hook-events-rotated-<ts>/`, so the live directory alone undercounts a run.
const ARCHIVE_DIR = /^hook-events-/;

function eventDirs(campaignDir: string): string[] {
  const archive = path.join(campaignDir, 'archive');
  const archived = fs.existsSync(archive)
    ? fs.readdirSync(archive).filter((d) => ARCHIVE_DIR.test(d)).map((d) => path.join(archive, d))
    : [];
  return [path.join(campaignDir, 'hook-events'), ...archived];
}

/**
 * Deny (`tier: block`) and warn (`tier: warn`) hook events per `pattern_id`, live and archived,
 * most frequent rule first. `since` (the campaign start) drops older events; an event with no
 * `recorded_at` is kept. Unreadable files are skipped, as in hook-event triage.
 */
export function collectDenyCounts(campaignDir: string, since: string | null): DenyCount[] {
  const byRule = new Map<string, DenyCount>();
  for (const dir of eventDirs(campaignDir)) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const file = path.join(dir, name);
      let event: HookEvent;
      try {
        event = readJsonFile(file, file) as HookEvent;
      } catch {
        continue;
      }
      if (event.tier !== 'block' && event.tier !== 'warn') continue;
      if (since != null && event.recorded_at != null && event.recorded_at < since) continue;
      const id = event.pattern_id ?? 'unknown';
      const row = byRule.get(id) ?? { pattern_id: id, deny: 0, warn: 0 };
      row[event.tier === 'block' ? 'deny' : 'warn'] += 1;
      byRule.set(id, row);
    }
  }
  return [...byRule.values()].sort(
    (a, b) => b.deny + b.warn - (a.deny + a.warn) || b.deny - a.deny || a.pattern_id.localeCompare(b.pattern_id),
  );
}

export const topDenyCounts = (rows: DenyCount[]): DenyCount[] => rows.slice(0, DENY_COUNTS_TOP);
