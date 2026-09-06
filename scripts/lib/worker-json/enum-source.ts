import * as fs from 'fs';
import * as path from 'path';
import type { Role } from './types.ts';
import { validateWorker as validateWorkerFromOwnTree } from './validate.ts';

/** Validates a worker return against one role's schema, returning one string per violation. */
export type ValidateWorkerFn = (role: Role, data: unknown) => string[];

/** Path, relative to an `--enum-source` tree root, of the validator entry module to load. */
export const ENUM_SOURCE_VALIDATOR_SUBPATH = 'scripts/lib/worker-json/validate.ts';

/**
 * Path, relative to an `--enum-source` tree root, of the constants module whose exported
 * `as const` arrays are read as plain text — never imported — to learn a widened tree's enum
 * membership.
 */
export const ENUM_SOURCE_CONSTANTS_SUBPATH = path.join(
  path.dirname(ENUM_SOURCE_VALIDATOR_SUBPATH),
  'constants.ts',
);

/**
 * Usage error for an `--enum-source` flag whose value never arrived. Shares the shape of the
 * unresolvable-tree errors {@link resolveValidateWorker} throws, and is fatal for the same
 * reason: silently dropping the flag would validate against the local tree while reporting
 * nothing, making a mistyped invocation indistinguishable from one that named no tree at all.
 */
export const ENUM_SOURCE_MISSING_VALUE_ERROR =
  '--enum-source: expected a tree root path, got no value';

const ENUM_ERROR_PATTERN = /^(.+): invalid enum value "(.*)" \(expected (.+)\)$/;
const STRING_CONST_PATTERN = /export const (\w+)\s*=\s*'([^']*)'\s*as const;/g;
const ENUM_ARRAY_PATTERN = /export const \w+\s*=\s*\[([^\]]*)\]\s*as const/g;

/**
 * Extracts every exported `as const` string array's member list from a `constants.ts` source
 * text, without ever evaluating the file as code. An element that is itself an exported string
 * constant rather than a literal (e.g. `PLANNER_STATUSES = [..., PARTIAL_STATUS]`) is resolved
 * through a separate single-const pass first — left as a bare identifier it would never match a
 * quoted enum value, making the array look one member short.
 */
function extractEnumArrays(source: string): string[][] {
  const stringConsts = new Map<string, string>();
  for (const match of source.matchAll(STRING_CONST_PATTERN)) {
    stringConsts.set(match[1], match[2]);
  }

  const arrays: string[][] = [];
  for (const match of source.matchAll(ENUM_ARRAY_PATTERN)) {
    const members = match[1]
      .split(',')
      .map((raw) => raw.trim())
      .filter((raw) => raw.length > 0)
      .map((raw) => {
        const quoted = raw.match(/^['"]([^'"]*)['"]$/);
        return quoted ? quoted[1] : (stringConsts.get(raw) ?? null);
      })
      .filter((member): member is string => member !== null);
    if (members.length > 0) {
      arrays.push(members);
    }
  }
  return arrays;
}

/**
 * Drops an "invalid enum value" error when some array in `widenedArrays` is a superset of both
 * the error's own `(expected ...)` list and the rejected value — i.e. the named tree's
 * `constants.ts` declares that same enum with the rejected value added. Every other error
 * (structural, type, or an enum value the widened tree doesn't declare either) passes through
 * unchanged.
 */
function waiveWidenedEnumErrors(errors: string[], widenedArrays: string[][]): string[] {
  return errors.filter((error) => {
    const match = error.match(ENUM_ERROR_PATTERN);
    if (!match) {
      return true;
    }
    const [, , value, expectedJoined] = match;
    const expected = expectedJoined.split('|');
    const isWidened = widenedArrays.some(
      (candidate) =>
        candidate.includes(value) && expected.every((member) => candidate.includes(member)),
    );
    return !isWidened;
  });
}

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
 *
 * The named tree is a worker's own unreviewed PR worktree, so its code is never executed.
 * `constants.ts` is read as plain text and its enum arrays are extracted by regex (see
 * {@link extractEnumArrays}), then used only to waive the *local*, statically imported
 * validator's "invalid enum value" errors that the widened tree's own declaration would accept
 * (see {@link waiveWidenedEnumErrors}). Every other violation the local validator finds —
 * missing fields, wrong types, an enum value the named tree doesn't declare either — still
 * fails the run.
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

  const constantsPath = path.join(treeRoot, ENUM_SOURCE_CONSTANTS_SUBPATH);
  const constantsSource = fs.existsSync(constantsPath) ? fs.readFileSync(constantsPath, 'utf-8') : '';
  const widenedArrays = extractEnumArrays(constantsSource);

  return (role: Role, data: unknown) =>
    waiveWidenedEnumErrors(validateWorkerFromOwnTree(role, data), widenedArrays);
}
