import * as fs from 'fs';
import * as path from 'path';
import { appendIndexRowIfAbsent, parseIndexTableRows, type RootIndexRow } from './check-common.ts';
import { parseFrontmatterFields, parseMdFrontmatter } from './build/content.ts';
import { readJsonFile } from './fs.ts';
import { isCarryTargetAllowed } from './carry-target-allowlist.ts';

// Issue #715 (R-10) — mechanizes the mechanical two-thirds of `implementer.md` § Carry Staged
// Artifacts: the manifest shape guard, `target_kind` dispatch, the 9-row frontmatter rewrite
// mapping (investigator `new_file` entries), and `append_row` dedup for both discriminator
// shapes. Ported verbatim from the prose — no new behavior invented. Search-before-write (the
// one live-repo judgment the prose keeps) is deliberately NOT here — `implementer.md`'s shrunk
// prose states it as the agent's own responsibility around this script's invocation.

export type ManifestEntry = {
  route: string;
  sub_mode: string | null;
  produced_by: string;
  declared_at: string;
  staged_path: string;
  target_path: string;
  target_kind: string;
  [key: string]: unknown;
};

export type Manifest = {
  issue: number;
  updated_at: string;
  entries: ManifestEntry[];
};

export type ValidEntry = ManifestEntry & { target_kind: 'new_file' | 'append_row' };

export type SkippedEntry = { index: number; reason: string };

export type CarryOutcome = {
  carriedPaths: string[];
  skippedEntries: SkippedEntry[];
};

const REQUIRED_FIELDS = [
  'route',
  'sub_mode',
  'produced_by',
  'declared_at',
  'staged_path',
  'target_path',
  'target_kind',
] as const;

/**
 * Manifest shape guard (`implementer.md` § Carry Staged Artifacts, Defensive shape guard). An
 * absent manifest is a distinct, non-error no-op ("nothing was staged for this issue") —
 * `readJsonFile` covers the zero-byte/unparseable case once existence is confirmed, closing the
 * `jq empty` pitfall documented at `blackhole-state.md` § Write protocol (never conflate the two
 * — a failed staging write must not be silently read as "nothing staged").
 */
export const loadManifest = (manifestPath: string): Manifest | null => {
  if (!fs.existsSync(manifestPath)) return null;
  return readJsonFile(manifestPath, manifestPath) as Manifest;
};

/**
 * Per-entry field validation. A malformed entry (missing required field, or an out-of-enum
 * `target_kind`) is skipped with a reason and never fatal to the rest of the manifest.
 */
export const validateEntries = (
  entries: unknown[],
): { valid: ValidEntry[]; skipped: SkippedEntry[] } => {
  const valid: ValidEntry[] = [];
  const skipped: SkippedEntry[] = [];

  entries.forEach((raw, index) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const missing = REQUIRED_FIELDS.filter((field) => {
      if (field === 'sub_mode') return !(field in entry); // sub_mode may be null but must be present
      const value = entry[field];
      return value === undefined || value === null || value === '';
    });
    if (missing.length > 0) {
      skipped.push({ index, reason: `missing required field(s): ${missing.join(', ')}` });
      return;
    }
    if (entry.target_kind !== 'new_file' && entry.target_kind !== 'append_row') {
      skipped.push({
        index,
        reason: `target_kind must be "new_file" or "append_row", got ${JSON.stringify(entry.target_kind)}`,
      });
      return;
    }
    valid.push(entry as ValidEntry);
  });

  return { valid, skipped };
};

export type CopyMode = 'verbatim' | 'rewrite';

/**
 * `new_file` copy-mode decision. The sole rewrite case is an investigator analyze/investigate
 * note — every other producer/route (`planner`+plan, `planner`+design, `implementer`+review, and
 * any future route that follows the same shape) already rendered the target doc-governance
 * schema at staging time and is copied verbatim (`implementer.md` § Carry Staged Artifacts).
 */
export const decideCopyMode = (entry: { produced_by: string; sub_mode: string | null }): CopyMode =>
  entry.produced_by === 'investigator' && (entry.sub_mode === 'analyze' || entry.sub_mode === 'investigate')
    ? 'rewrite'
    : 'verbatim';

const SUB_MODE_TO_TYPE: Record<string, string> = { analyze: 'analysis', investigate: 'analysis' };
const PASSTHROUGH_FRONTMATTER_KEYS = ['issue', 'confidence', 'computed_at_revision'] as const;

/**
 * The 9-row frontmatter rewrite mapping (`implementer.md` § Carry Staged Artifacts) — the
 * investigator working-note schema (`investigator.md` § Note schema) rewritten into the
 * `doc-governance.md` lifecycle schema. `related`/`supersedes` are omitted unless a caller
 * supplies `supersedes` (a search-before-write result — the one step this function does not
 * itself decide).
 */
export const rewriteInvestigatorFrontmatter = (
  stagedContent: string,
  entry: { sub_mode: string | null; declared_at: string },
  today: string,
  supersedes?: string,
): string => {
  const { frontmatter, body } = parseMdFrontmatter(stagedContent);
  const fields = parseFrontmatterFields(frontmatter);
  const type = SUB_MODE_TO_TYPE[entry.sub_mode ?? ''] ?? 'analysis';
  const created = entry.declared_at.slice(0, 10);

  const lines = [
    `type: ${type}`,
    'status: current',
    `created: ${created}`,
    `last_updated: ${today}`,
    'review_trigger: "on file change"',
  ];
  for (const key of PASSTHROUGH_FRONTMATTER_KEYS) {
    if (fields[key] !== undefined) lines.push(`${key}: ${fields[key]}`);
  }
  if (supersedes) lines.push(`supersedes: ${supersedes}`);

  return `---\n${lines.join('\n')}\n---\n${body}`;
};

// --- append_row dedup, bullet-list discriminator (`target_path === "ARCHITECTURE.md"`) ---
// Ported verbatim from planner.md's own near-duplicate check (§4.8 Trigger A / Step 4 Trigger
// B) — the mandatory trailing `(ADR-{NNN})` / `(analyze: issue #N)` citation suffix — reused
// rather than a second mechanism (V-INT-02, issue #557).

const citationSuffix = (bulletLine: string): string | null => {
  const match = bulletLine.match(/\(([^()]+)\)\s*$/);
  return match ? `(${match[1]})` : null;
};

const activeConstraintsBullets = (architectureMd: string): string[] => {
  const section = architectureMd.split('## Active Constraints')[1] ?? '';
  const body = section.split(/\n## /)[0] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
};

export const appendConstraintBulletIfAbsent = (
  architectureMd: string,
  stagedBullet: string,
): { content: string; appended: boolean } => {
  const suffix = citationSuffix(stagedBullet);
  const alreadyCarried = activeConstraintsBullets(architectureMd).some((bullet) => citationSuffix(bullet) === suffix);
  if (alreadyCarried) return { content: architectureMd, appended: false };

  const marker = '## Active Constraints';
  const insertAt = architectureMd.indexOf(marker) + marker.length;
  const content = `${architectureMd.slice(0, insertAt)}\n${stagedBullet}${architectureMd.slice(insertAt)}`;
  return { content, appended: true };
};

/**
 * `append_row` dedup, pipe-table discriminator (`documentation/decisions/INDEX.md`,
 * `documentation/INDEX.md`) — the row's `path` column value. Delegates to `check-common.ts`'s
 * `appendIndexRowIfAbsent` (V-INT-02) — a future sorted-insert change (#743) is a one-line swap
 * at that shared call site, not a rewrite here.
 */
export const appendPipeTableRowIfAbsent = (
  existingContent: string,
  stagedFragment: string,
): { content: string; appended: boolean } => {
  const [row] = parseIndexTableRows(stagedFragment);
  if (!row) throw new Error(`staged append_row fragment did not parse as a table row: ${stagedFragment}`);
  return appendIndexRowIfAbsent(existingContent, row as RootIndexRow);
};

/**
 * Realpath of the nearest existing ancestor of `p` — `p` itself when it already exists (resolved
 * through, if it is itself a symlink), otherwise the nearest parent that does. A `new_file`
 * target routinely does not exist yet, so a bare `fs.realpathSync` would throw, while any
 * intermediate directory on the way to it may be a symlink pointing out of the root — the walk-up
 * is what lets the containment comparison below run on resolved paths in both cases.
 *
 * Same algorithm as the identically-named helper in
 * `templates/hooks/pretooluse/utils/hook-event-log.js`, re-implemented rather than imported: that
 * tree is CommonJS mirrored verbatim into the per-platform hook dists and shares no build target
 * with this Bun/ESM module tree, so there is no import path between them.
 */
const resolveExistingAncestor = (p: string): string => {
  let current = path.resolve(p);
  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
};

/** True when `candidate` resolves inside (or as) `root`, both sides resolved through
 * `resolveExistingAncestor` first — either side may traverse a symlink (an OS tmpdir routinely
 * is one), so a raw `path.resolve` + `startsWith` comparison decides containment on unresolved
 * strings and misses exactly the symlinked-ancestor case. */
const isWithinRoot = (candidate: string, root: string): boolean => {
  const realCandidate = resolveExistingAncestor(candidate);
  const realRoot = resolveExistingAncestor(root);
  return realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep);
};

/**
 * Runs the full carry: shape guard already applied by the caller (`loadManifest`) → validate →
 * dispatch per entry. Returns carried target paths (manifest order) and skipped-entry reasons
 * for the caller to log as `new_findings[]` — this function never writes to the ledger itself.
 *
 * Path containment (issue #752): a manifest entry's `staged_path`/`target_path` are free JSON
 * text written by an LLM producer whose context includes untrusted forge issue bodies, and
 * nothing upstream forces them through `concern-slug.ts`'s sanitizer. Each is therefore bounded
 * against its own root before any `fs` call touches it. A violation is entry-scoped adversarial
 * content — the same class as a malformed field, so it joins the `skipped` array and the rest of
 * the manifest still carries — deliberately not the fatal throw below, which signals a broken
 * invocation and so invalidates every entry's result at once.
 *
 * Two-root resolution (issue #760): `staged_path` and `target_path` never share a tree in an
 * implementer's actual working environment — `staged_path` lives under the gitignored,
 * main-clone-only `.blackhole/` (`blackhole-state.md` § Staging), while `target_path` must land
 * in the worktree checked out for the PR. `opts.stagingRoot` (default `repoRoot`, matching the
 * existing `opts.today` optional-parameter shape) resolves `staged_path` only — `target_path`
 * always resolves against `repoRoot`, since that is where the PR branch lives.
 */
export const carryManifest = (
  manifest: Manifest,
  repoRoot: string,
  opts: { today?: string; stagingRoot?: string } = {},
): CarryOutcome => {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const stagingRoot = opts.stagingRoot ?? repoRoot;
  const entries = manifest.entries ?? [];
  const { valid, skipped } = validateEntries(entries);
  const carriedPaths: string[] = [];

  for (const entry of valid) {
    const index = entries.indexOf(entry);
    const stagedAbs = path.join(stagingRoot, entry.staged_path);
    const targetAbs = path.join(repoRoot, entry.target_path);

    if (!isWithinRoot(stagedAbs, stagingRoot)) {
      skipped.push({
        index,
        reason: `staged_path "${entry.staged_path}" resolves outside stagingRoot ${stagingRoot}`,
      });
      continue;
    }
    if (!isWithinRoot(targetAbs, repoRoot)) {
      skipped.push({
        index,
        reason: `target_path "${entry.target_path}" resolves outside repoRoot ${repoRoot}`,
      });
      continue;
    }

    // Allowlist (issue #784 AC1): containment alone leaves every in-repo path writable —
    // `package.json`, `.github/workflows/*.yml`, `.git/hooks/*` all pass `isWithinRoot` and reach
    // an unconditional write below. Entry-scoped, same as the containment checks above: joins
    // `skipped` and the rest of the manifest still carries.
    if (!isCarryTargetAllowed(entry.target_path)) {
      skipped.push({
        index,
        reason: `target_path "${entry.target_path}" is outside the carry allowlist (documentation/** or root ARCHITECTURE.md)`,
      });
      continue;
    }

    // Named, non-bare failure (never a raw ENOENT — `readJsonFile`'s convention,
    // `scripts/lib/fs.ts:53-60`): a declared staged_path that does not resolve under
    // stagingRoot is always fatal, distinguishable from a validation-level skip.
    if (!fs.existsSync(stagedAbs)) {
      throw new Error(
        `carryManifest: entries[${index}].staged_path "${entry.staged_path}" not found under stagingRoot ${stagingRoot} (repoRoot ${repoRoot})`,
      );
    }

    if (entry.target_kind === 'new_file') {
      const raw = fs.readFileSync(stagedAbs, 'utf-8');
      const content = decideCopyMode(entry) === 'rewrite' ? rewriteInvestigatorFrontmatter(raw, entry, today) : raw;
      // Write-step FS errors (issue #784 AC2/AC3) are entry-scoped, not invocation-scoped — a
      // worktree-shaped `.git` (ENOTDIR) or any other write failure skips this one entry instead
      // of throwing and denying the rest of the manifest. Distinct from the "declared staged_path
      // absent" throw above, which stays fatal — it signals a broken invocation, not adversarial
      // entry content.
      try {
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
        fs.writeFileSync(targetAbs, content);
        carriedPaths.push(entry.target_path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({ index, reason: `write failed for target_path "${entry.target_path}": ${message}` });
      }
      continue;
    }

    const fragment = fs.readFileSync(stagedAbs, 'utf-8').trim();
    const existing = fs.existsSync(targetAbs) ? fs.readFileSync(targetAbs, 'utf-8') : '';
    const result =
      entry.target_path === 'ARCHITECTURE.md'
        ? appendConstraintBulletIfAbsent(existing, fragment)
        : appendPipeTableRowIfAbsent(existing, fragment);
    if (result.appended) {
      try {
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
        fs.writeFileSync(targetAbs, result.content);
        carriedPaths.push(entry.target_path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({ index, reason: `write failed for target_path "${entry.target_path}": ${message}` });
      }
    }
  }

  return { carriedPaths, skippedEntries: skipped };
};
