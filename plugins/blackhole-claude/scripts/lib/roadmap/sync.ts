import * as fs from 'fs';
import * as path from 'path';
import type { QueueJson } from '../campaign-status/types.ts';
import { appendIndexRowIfAbsent } from '../check-common.ts';
import { ROOT_DOC_INDEX_PATH, isRegenerableRootIndex, rootIndexRowFor } from '../doc-index-generate.ts';
import { buildRoadmap, renderRoadmapBody } from './render.ts';

// Writes the roadmap document where the consumer's config declares one, and only when the ranking
// changed. The framework names no path: an absent `roadmap.path` is a no-op, so a repo that never
// opted in is never touched.

export type RoadmapConfig = {
  docs_governance?: { enabled?: boolean };
  roadmap?: { enabled?: boolean; path?: string };
};

export type RoadmapTarget = { target: string } | { skip: 'no-path' | 'disabled' };

const WINDOWS_DRIVE = /^[A-Za-z]:/;

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
  if (declared === '' || path.isAbsolute(declared) || WINDOWS_DRIVE.test(declared) || !relative.endsWith('.md') || !target.startsWith(root + path.sep)) {
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

/** What happened to the roadmap's row in `documentation/INDEX.md`. */
export type IndexOutcome = 'added' | 'present' | 'skipped' | 'none';

export type RoadmapSync =
  | { status: 'written' | 'unchanged'; path: string; index: IndexOutcome }
  | { status: 'skipped'; reason: 'no-path' | 'disabled' };

/**
 * Doc governance: a roadmap under `documentation/` gets its row in `documentation/INDEX.md`, built
 * from the file's own frontmatter and inserted in path order. A repo without that index gets none
 * created, and an index that is not blackhole's own shape (`isRegenerableRootIndex`) is left alone.
 */
function upsertIndexRow(repoRoot: string, rel: string, text: string): IndexOutcome {
  const docsPrefix = 'documentation/';
  const indexAbs = path.join(repoRoot, ROOT_DOC_INDEX_PATH);
  if (!rel.startsWith(docsPrefix) || !fs.existsSync(indexAbs)) return 'none';
  const existing = fs.readFileSync(indexAbs, 'utf-8');
  if (!isRegenerableRootIndex(existing)) return 'skipped';
  const row = rootIndexRowFor(rel.slice(docsPrefix.length), text);
  if (row === null) return 'none';
  const { content, appended } = appendIndexRowIfAbsent(existing, row);
  if (appended) fs.writeFileSync(indexAbs, content);
  return appended ? 'added' : 'present';
}

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
  if (existing !== null && match && existing.slice(match[0].length) === body) {
    return { status: 'unchanged', path: rel, index: upsertIndexRow(opts.repoRoot, rel, existing) };
  }
  const created = /^created: (\d{4}-\d{2}-\d{2})$/m.exec(match?.[1] ?? '')?.[1] ?? opts.date;
  const text = frontmatter(created, opts.date) + body;
  fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
  fs.writeFileSync(resolved.target, text);
  return { status: 'written', path: rel, index: upsertIndexRow(opts.repoRoot, rel, text) };
}
