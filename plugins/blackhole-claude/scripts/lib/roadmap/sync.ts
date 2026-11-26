import * as fs from 'fs';
import * as path from 'path';
import type { QueueJson } from '../campaign-status/types.ts';
import { buildRoadmap, renderRoadmapBody } from './render.ts';

// Writes the roadmap document where the consumer's config declares one, and only when the ranking
// changed. The framework names no path: an absent `roadmap.path` is a no-op, so a repo that never
// opted in is never touched.

export type RoadmapConfig = {
  docs_governance?: { enabled?: boolean };
  roadmap?: { enabled?: boolean; path?: string };
};

export type RoadmapTarget = { target: string } | { skip: 'no-path' | 'disabled' };

const fail = (key: string, why: string): never => {
  throw new Error(`roadmap config: ${key} ${why}`);
};

/**
 * `roadmap.path` (repo-relative, `.md`) names the file; without it nothing runs. `roadmap.enabled`
 * switches it off, and when unset follows `docs_governance.enabled` resolving to the literal `true`
 * (`config-template.md` § `docs_governance` resolution).
 */
export function resolveRoadmapTarget(config: RoadmapConfig | undefined, repoRoot: string): RoadmapTarget {
  const block = config?.roadmap;
  const declared = block?.path;
  if (declared === undefined) return { skip: 'no-path' };
  if (typeof declared !== 'string') return fail('roadmap.path', 'must be a string');
  if (block?.enabled !== undefined && typeof block.enabled !== 'boolean') return fail('roadmap.enabled', 'must be a boolean');
  const enabled = block?.enabled ?? config?.docs_governance?.enabled === true;
  if (!enabled) return { skip: 'disabled' };
  const relative = path.posix.normalize(declared.replace(/\\/g, '/'));
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, relative);
  if (declared === '' || path.isAbsolute(declared) || !relative.endsWith('.md') || !target.startsWith(root + path.sep)) {
    return fail('roadmap.path', `must be a repo-relative .md path inside the repo (got ${JSON.stringify(declared)})`);
  }
  return { target };
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n\n/;

const frontmatter = (created: string, updated: string): string =>
  [
    '---',
    'type: reference',
    'summary: "Ranked roadmap of every open issue, regenerated from the campaign scores"',
    'status: current',
    'review_trigger: "on file change"',
    `created: ${created}`,
    `last_updated: ${updated}`,
    '---',
    '',
    '',
  ].join('\n');

export type RoadmapSync =
  | { status: 'written' | 'unchanged'; path: string }
  | { status: 'skipped'; reason: 'no-path' | 'disabled' };

/**
 * Renders the roadmap from the queue and writes it when its body differs from the file on disk;
 * `created` survives a rewrite and `last_updated` moves to `date`. `date` is passed in, never read
 * from the clock, so the comparison and the output stay deterministic.
 */
export function syncRoadmap(opts: { queue: QueueJson | undefined; config: RoadmapConfig | undefined; repoRoot: string; date: string }): RoadmapSync {
  const resolved = resolveRoadmapTarget(opts.config, opts.repoRoot);
  if ('skip' in resolved) return { status: 'skipped', reason: resolved.skip };
  const rel = path.relative(path.resolve(opts.repoRoot), resolved.target).split(path.sep).join('/');
  const body = renderRoadmapBody(buildRoadmap(opts.queue));
  const existing = fs.existsSync(resolved.target) ? fs.readFileSync(resolved.target, 'utf-8') : null;
  const match = existing === null ? null : FRONTMATTER.exec(existing);
  if (existing !== null && match && existing.slice(match[0].length) === body) return { status: 'unchanged', path: rel };
  const created = /^created: (\d{4}-\d{2}-\d{2})$/m.exec(match?.[1] ?? '')?.[1] ?? opts.date;
  fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
  fs.writeFileSync(resolved.target, frontmatter(created, opts.date) + body);
  return { status: 'written', path: rel };
}
