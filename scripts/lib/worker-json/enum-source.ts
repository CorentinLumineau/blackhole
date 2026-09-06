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
 * Upper bound on a widened `constants.ts`'s byte size (F-00049, PR #854 review iteration 2). The
 * path is always inside a worker's own unreviewed worktree ({@link resolveValidateWorker}'s trust
 * boundary), so an unbounded `readFileSync` on it is a self-inflicted resource-exhaustion vector —
 * a symlink to a FIFO or an unbounded device file at that path would hang or OOM the orchestrator.
 * Any real `constants.ts` today is under 4KB; this leaves generous headroom without allowing an
 * arbitrarily large read.
 */
const MAX_ENUM_SOURCE_CONSTANTS_BYTES = 65_536;

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
 * Field names that at least one role validator uses to select *which required-field checks run*,
 * based on the field's own enum-checked value — e.g. implementer's `status: 'complete'` branch
 * gates `pr_number`/`branch`/`tests_passed`/`touch_paths_honored`/`evidence`. A widened-enum
 * waiver must never apply to one of these, no matter how exactly the widened tree's array matches
 * the cardinality bound above: accepting an unrecognized discriminator value skips every
 * required-field check gated on it, turning a near-empty stub payload into a zero-error accept
 * (F-00060, PR #854 review iteration 4 — `{status: 'BOGUS'}` against a widened
 * `IMPLEMENTER_STATUSES` array passed with none of the five `complete`-branch fields present).
 *
 * Derived by grepping `scripts/lib/worker-json/validators/*.ts` for a `data.<field> ===`/`!==`
 * comparison against a string literal, on a field the same file also enum-checks via
 * `pushEnumError`: `status` appears in this shape in all six role validators; `track`
 * (planner.ts) gates its design/brainstorm-specific required fields; `escalation_trigger`
 * (implementer.ts) gates `conflict_hunks`; `sprint_contract_status` (implementer.ts) gates
 * `ac_results`. `COMPANION_REPAIR_VCODES`'s `vcode` field — the enum issue #738 exists to widen —
 * is deliberately absent: it is enum-checked but gates no required-field branch, so widening it
 * stays waivable.
 *
 * Hand-maintained rather than derived at runtime — parsing our own statically-imported validator
 * source as data would be the same fragile-parsing trade `extractEnumArrays` above accepts only
 * because the widened tree's `constants.ts` can't be imported at all (untrusted code). Kept
 * honest by the anti-rot assertion in `enum-source.test.ts`
 * ("NON_WAIVABLE_DISCRIMINATOR_FIELDS — exhaustive against validator source (F-00060)"), which
 * fails the moment a validator gains a new enum-checked `data.<field> === '...'` branch this set
 * doesn't list.
 */
export const NON_WAIVABLE_DISCRIMINATOR_FIELDS: ReadonlySet<string> = new Set([
  'status',
  'track',
  'escalation_trigger',
  'sprint_contract_status',
]);

/**
 * Drops an "invalid enum value" error when some array in `widenedArrays` is *exactly* the
 * error's own `(expected ...)` list plus the rejected value — i.e. the named tree's
 * `constants.ts` declares that same enum with the rejected value added, and nothing else. Every
 * other error (structural, type, or an enum value the widened tree doesn't declare either)
 * passes through unchanged.
 *
 * The exact-cardinality check (`candidate.length === expected.length + 1`) is load-bearing, not
 * an optimization (F-00048, PR #854 review iteration 2). Without it, a superset-only check is
 * satisfiable by a single "kitchen sink" array unioning every real enum member across the whole
 * schema plus one bogus value — that array is a superset of *every* field's `expected` list, so
 * it waives an invalid-enum error for a field it was never declared for. Because `value` is
 * guaranteed distinct from `expected` (the local validator only raises this error when the value
 * isn't already in `expected`), a candidate that both is a superset of `expected ∪ {value}` and
 * has exactly `expected.length + 1` elements can only be that exact set — no room for members
 * belonging to a different field's enum. This is what actually enforces this function's
 * docstring-level "exactly one new member" invariant; the old code stated the invariant but never
 * checked it.
 *
 * A field in {@link NON_WAIVABLE_DISCRIMINATOR_FIELDS} is excluded from this entirely (F-00060):
 * cardinality only bounds *which* array can satisfy the waiver, not *whether* waiving is safe for
 * that field at all, and a discriminator's required-field-gating role makes it never safe.
 */
function waiveWidenedEnumErrors(errors: string[], widenedArrays: string[][]): string[] {
  return errors.filter((error) => {
    const match = error.match(ENUM_ERROR_PATTERN);
    if (!match) {
      return true;
    }
    const [, field, value, expectedJoined] = match;
    if (NON_WAIVABLE_DISCRIMINATOR_FIELDS.has(field)) {
      return true;
    }
    const expected = expectedJoined.split('|');
    const isWidened = widenedArrays.some(
      (candidate) =>
        candidate.length === expected.length + 1 &&
        candidate.includes(value) &&
        expected.every((member) => candidate.includes(member)),
    );
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
