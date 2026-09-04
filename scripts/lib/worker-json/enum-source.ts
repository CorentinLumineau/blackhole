import * as fs from 'fs';
import * as path from 'path';
import type { Role } from './types.ts';
import { validateWorker as validateWorkerFromOwnTree } from './validate.ts';

/** Validates a worker return against one role's schema, returning one string per violation. */
export type ValidateWorkerFn = (role: Role, data: unknown) => string[];

/** Path, relative to an `--enum-source` tree root, of the validator entry module to load. */
export const ENUM_SOURCE_VALIDATOR_SUBPATH = 'scripts/lib/worker-json/validate.ts';

/**
 * Usage error for an `--enum-source` flag whose value never arrived. Shares the shape of the
 * unresolvable-tree errors {@link resolveValidateWorker} throws, and is fatal for the same
 * reason: silently dropping the flag would validate against the local tree while reporting
 * nothing, making a mistyped invocation indistinguishable from one that named no tree at all.
 */
export const ENUM_SOURCE_MISSING_VALUE_ERROR =
  '--enum-source: expected a tree root path, got no value';

/**
 * Resolves the `validateWorker` implementation whose enum membership
 * (`constants.ts`) a validation run is judged against. A worker return that
 * introduces a new enum member can only be validated against the tree that
 * declares it, so the caller names that tree — typically the PR worktree whose
 * branch widens the enum — instead of being pinned to the tree the validator
 * itself was launched from.
 *
 * `null` (the default) keeps the validator's own statically imported tree, so
 * every existing call site is unchanged. A named tree with no validator module
 * throws rather than silently degrading to the local enums, which would make an
 * accepted payload indistinguishable from an unresolved source path.
 */
export async function resolveValidateWorker(enumSource: string | null): Promise<ValidateWorkerFn> {
  if (enumSource === null) {
    return validateWorkerFromOwnTree;
  }

  const treeRoot = path.resolve(enumSource);
  const modulePath = path.join(treeRoot, ENUM_SOURCE_VALIDATOR_SUBPATH);
  if (!fs.existsSync(modulePath)) {
    throw new Error(`--enum-source ${treeRoot}: no validator module at ${modulePath}`);
  }

  const module: unknown = await import(modulePath);
  const validateWorker = (module as { validateWorker?: unknown }).validateWorker;
  if (typeof validateWorker !== 'function') {
    throw new Error(`--enum-source ${treeRoot}: ${modulePath} exports no validateWorker function`);
  }

  return validateWorker as ValidateWorkerFn;
}
