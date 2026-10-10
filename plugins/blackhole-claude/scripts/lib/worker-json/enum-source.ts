import * as fs from 'fs';
import * as path from 'path';
import * as ownEnumConstants from './constants.ts';
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
const ENUM_ARRAY_PATTERN = /export const (\w+)\s*=\s*\[([^\]]*)\]\s*as const/g;

/**
 * Upper bound on a widened `constants.ts`'s byte size (F-00049, PR #854 review iteration 2). The
 * path is always inside a worker's own unreviewed worktree ({@link resolveValidateWorker}'s trust
 * boundary), so an unbounded `readFileSync` on it is a self-inflicted resource-exhaustion vector —
 * a symlink to a FIFO or an unbounded device file at that path would hang or OOM the orchestrator.
 * Any real `constants.ts` today is under 4KB; this leaves generous headroom without allowing an
 * arbitrarily large read.
 */
const MAX_ENUM_SOURCE_CONSTANTS_BYTES = 65_536;

/**
 * Extracts every exported `as const` string array from a `constants.ts` source text, keyed by
 * its own constant name, without ever evaluating the file as code. An element that is itself an
 * exported string constant rather than a literal (e.g. `PLANNER_STATUSES = [..., PARTIAL_STATUS]`)
 * is resolved through a separate single-const pass first — left as a bare identifier it would
 * never match a quoted enum value, making the array look one member short.
 *
 * The name is load-bearing (PR #854 review iteration 6): {@link waiveWidenedEnumErrors} binds a
 * waiver decision to *which named constant* the widened tree declares, not merely to array
 * content, so a widened `constants.ts` can only widen the specific enum it claims to.
 */
function extractEnumArrays(source: string): Map<string, string[]> {
  const stringConsts = new Map<string, string>();
  for (const match of source.matchAll(STRING_CONST_PATTERN)) {
    stringConsts.set(match[1], match[2]);
  }

  const arrays = new Map<string, string[]>();
  for (const match of source.matchAll(ENUM_ARRAY_PATTERN)) {
    const [, name, rawMembers] = match;
    const members = rawMembers
      .split(',')
      .map((raw) => raw.trim())
      .filter((raw) => raw.length > 0)
      .map((raw) => {
        const quoted = raw.match(/^['"]([^'"]*)['"]$/);
        return quoted ? quoted[1] : (stringConsts.get(raw) ?? null);
      })
      .filter((member): member is string => member !== null);
    if (members.length > 0) {
      arrays.set(name, members);
    }
  }
  return arrays;
}

/**
 * Names of `constants.ts` exports whose widening a worker-return validation run may waive —
 * an allowlist, not a blocklist (PR #854 review iteration 6). Iterations 4 and 5 each enumerated
 * a *dangerous* field the waiver must never apply to (`status`, `track`, `escalation_trigger`,
 * `sprint_contract_status`, then `capture_status`, `worktree_disposition` — the last two missed
 * because they live in `shared-validators.ts`, one directory outside where the anti-rot test for
 * that set scanned). That enumeration cannot be sound: it requires knowing about every
 * discriminator, in every file, in every comparison syntax, forever. Enumerating instead the
 * handful of enums this feature actually needs to widen makes an unlisted enum non-waivable *by
 * construction* — no discriminator audit required, and nothing to miss.
 *
 * `COMPANION_REPAIR_VCODES` is issue #738's entire actual need: `companion_repairs[].vcode` is
 * enum-checked but gates no required-field branch, so widening it is safe.
 */
export const WAIVABLE_ENUMS: ReadonlySet<string> = new Set(['COMPANION_REPAIR_VCODES']);

/**
 * Maps a local, trusted `constants.ts` array's exact member list (joined the same way
 * `pushEnumError` joins its `(expected ...)` clause, so an error's `expected` text is a direct
 * lookup key) back to the exported constant name that declares it. Built once, from this
 * package's own statically-imported `constants.ts` — never from the untrusted widened tree.
 *
 * A member list shared by two different constants (e.g. `IMPLEMENTER_STATUSES` and
 * `INVESTIGATOR_STATUSES` are both `complete|blocked|error|partial`) cannot be bound to a single
 * name from content alone, so both entries are dropped: the lookup then reports "unknown", which
 * {@link waiveWidenedEnumErrors} treats as non-waivable. This never affects
 * {@link WAIVABLE_ENUMS} today — `COMPANION_REPAIR_VCODES`'s member list is unique — and keeps
 * the fail-closed default even if a future collision ever involved an allowlisted enum.
 */
export const LOCAL_CONST_NAME_BY_MEMBERS: ReadonlyMap<string, string> = (() => {
  const byMembers = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [name, value] of Object.entries(ownEnumConstants)) {
    if (!Array.isArray(value) || !value.every((member) => typeof member === 'string')) {
      continue;
    }
    const key = (value as readonly string[]).join('|');
    if (byMembers.has(key) && byMembers.get(key) !== name) {
      ambiguous.add(key);
    } else {
      byMembers.set(key, name);
    }
  }
  for (const key of ambiguous) {
    byMembers.delete(key);
  }
  return byMembers;
})();

/**
 * Drops an "invalid enum value" error when the constant it was raised against is
 * {@link WAIVABLE_ENUMS}-allowlisted *and* the widened tree declares that same-named constant as
 * exactly the error's own `(expected ...)` list plus the rejected value. Every other error
 * (structural, type, an enum the allowlist doesn't cover, or an enum value the widened tree
 * doesn't declare either) passes through unchanged.
 *
 * Two bindings compose to make this fail-closed by default rather than by enumeration:
 *
 * 1. **Which constant.** {@link LOCAL_CONST_NAME_BY_MEMBERS} maps the error's own `expected` list
 *    back to the local, trusted constant name that declares it — never derived from the widened
 *    tree, so an untrusted `constants.ts` cannot claim to be a constant it isn't by naming an
 *    array it invented. An enum with no resolvable name (not exported at all, or ambiguous per
 *    that map's collision handling) is non-waivable.
 * 2. **Is it allowed.** Only a name in {@link WAIVABLE_ENUMS} proceeds to the cardinality check
 *    below at all. A newly introduced discriminator anywhere in the codebase is non-waivable the
 *    moment it exists, with no set to update — it was simply never added here.
 *
 * The exact-cardinality check itself (`candidate.length === expected.length + 1`) is
 * load-bearing, not an optimization (F-00048, PR #854 review iteration 2): it enforces this
 * function's "exactly one new member" invariant against the one, name-matched candidate array —
 * there is no longer a `some()` search across every widened array, because step 1 above already
 * identifies the single array that could possibly apply.
 */
function waiveWidenedEnumErrors(errors: string[], widenedArrays: Map<string, string[]>): string[] {
  return errors.filter((error) => {
    const match = error.match(ENUM_ERROR_PATTERN);
    if (!match) {
      return true;
    }
    const [, , value, expectedJoined] = match;
    const constName = LOCAL_CONST_NAME_BY_MEMBERS.get(expectedJoined);
    if (constName === undefined || !WAIVABLE_ENUMS.has(constName)) {
      return true;
    }
    const candidate = widenedArrays.get(constName);
    if (!candidate) {
      return true;
    }
    const expected = expectedJoined.split('|');
    const isWidened =
      candidate.length === expected.length + 1 &&
      candidate.includes(value) &&
      expected.every((member) => candidate.includes(member));
    return !isWidened;
  });
}

/**
 * Reads a widened tree's `constants.ts` as plain text, refusing anything that isn't a small
 * regular file (F-00049, PR #854 review iteration 2). `lstatSync` (not `statSync`) so a symlink
 * at this path is caught by its own link stat rather than by following it into whatever it
 * points at — the check must reject the link itself, not race a size check against a target that
 * could be a FIFO or unbounded device file. Returns `''` when the path doesn't exist at all
 * (a tree that declares no widened enums), matching this module's existing "no declaration"
 * convention.
 */
function readWidenedConstantsSource(constantsPath: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(constantsPath);
  } catch {
    return '';
  }
  if (!stat.isFile()) {
    throw new Error(
      `--enum-source: refusing to read ${constantsPath} — not a regular file (symlink, FIFO, or device)`,
    );
  }
  if (stat.size > MAX_ENUM_SOURCE_CONSTANTS_BYTES) {
    throw new Error(
      `--enum-source: ${constantsPath} is ${stat.size} bytes, exceeds the ${MAX_ENUM_SOURCE_CONSTANTS_BYTES}-byte cap`,
    );
  }
  return fs.readFileSync(constantsPath, 'utf-8');
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
  const constantsSource = readWidenedConstantsSource(constantsPath);
  const widenedArrays = extractEnumArrays(constantsSource);

  return (role: Role, data: unknown) =>
    waiveWidenedEnumErrors(validateWorkerFromOwnTree(role, data), widenedArrays);
}
