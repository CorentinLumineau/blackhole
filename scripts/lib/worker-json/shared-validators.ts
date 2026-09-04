import {
  AC_VERDICTS,
  CAPTURE_STATUSES,
  COMPANION_REPAIR_VCODES,
  DECISION_RECORD_KINDS,
  PARTIAL_PHASES,
  SEVERITIES,
  VERIFICATION_MODES,
  WORKTREE_DISPOSITIONS,
} from './constants.ts';
import {
  isNonEmptyString,
  isNumber,
  isObject,
  isString,
  isStringArray,
  pushEnumError,
  requireField,
} from './predicates.ts';

export function validateArrayOf(
  value: unknown,
  path: string,
  validateEntry: (entry: unknown, entryPath: string) => string[],
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return errors;
  }
  value.forEach((entry, index) => {
    errors.push(...validateEntry(entry, `${path}[${index}]`));
  });
  return errors;
}

export function validateFinding(finding: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(finding)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, finding, 'vcode', isString, 'string');
  requireField(errors, finding, 'severity', isString, 'string');
  if (isString(finding.severity)) {
    pushEnumError(errors, `${path}.severity`, finding.severity, SEVERITIES);
  }
  requireField(errors, finding, 'file', isString, 'string');
  requireField(errors, finding, 'line', isNumber, 'number');
  requireField(errors, finding, 'summary', isString, 'string');

  if (finding.vcode === 'V-PARETO-02') {
    requireField(errors, finding, 'gain', isNumber, 'number');
    requireField(errors, finding, 'effort', isNumber, 'number');
  }

  // ADR-036 (issue #815) — optional: absence means "no claim made" (backward compatible).
  if ('verification_mode' in finding && isString(finding.verification_mode)) {
    pushEnumError(errors, `${path}.verification_mode`, finding.verification_mode, VERIFICATION_MODES);
  } else if ('verification_mode' in finding) {
    errors.push(`${path}.verification_mode: expected string`);
  }

  return errors;
}

export function validateFindingsArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateFinding);
}

export function validateDecisionRecord(record: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(record)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, record, 'kind', isString, 'string');
  if (isString(record.kind)) {
    pushEnumError(errors, 'kind', record.kind, DECISION_RECORD_KINDS);
  }
  requireField(errors, record, 'touch_paths', isStringArray, 'string[]');
  requireField(errors, record, 'decision', isNonEmptyString, 'non-empty string');
  requireField(errors, record, 'why', isNonEmptyString, 'non-empty string');

  if (!isNumber(record.pr) && !isNumber(record.issue)) {
    errors.push('pr/issue: exactly one of pr or issue is required');
  }

  return errors.map((error) => `${path}.${error}`);
}

export function validateDecisionRecordsArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateDecisionRecord);
}

export function validateAcResult(row: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(row)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, row, 'criterion', isNonEmptyString, 'non-empty string');
  requireField(errors, row, 'check', isNonEmptyString, 'non-empty string');
  requireField(errors, row, 'result', isNonEmptyString, 'non-empty string');
  requireField(errors, row, 'verdict', isString, 'string');
  if (isString(row.verdict)) {
    pushEnumError(errors, 'verdict', row.verdict, AC_VERDICTS);
  }

  return errors.map((error) => `${path}.${error}`);
}

export function validateAcResultsArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateAcResult);
}

export function validateVisualEvidenceEntry(entry: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(entry)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, entry, 'target', isNumber, 'number');
  requireField(errors, entry, 'capture_status', isString, 'string');
  if (isString(entry.capture_status)) {
    pushEnumError(errors, 'capture_status', entry.capture_status, CAPTURE_STATUSES);
  }

  if (entry.capture_status === 'captured') {
    requireField(errors, entry, 'path', isNonEmptyString, 'non-empty string');
    requireField(errors, entry, 'route', isNonEmptyString, 'non-empty string');
    requireField(errors, entry, 'state', isNonEmptyString, 'non-empty string');
  }

  if (entry.capture_status === 'unavailable') {
    requireField(errors, entry, 'note', isNonEmptyString, 'non-empty string');
  }

  return errors.map((error) => `${path}.${error}`);
}

export function validateVisualEvidenceArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateVisualEvidenceEntry);
}

// ADR-036 (issue #815) — a clean/negative investigation leg (one that produces no `Finding`
// object) gets a structural home to disclose its verification basis into, sibling to
// `recheck[]`/`verification[]` (`worker-schemas.md` § Reviewer). Deliberately not named
// `verification` — that name is already claimed twice in this codebase for different meanings
// (the reviewer's own `verification[]` recheck array and `hunter`'s per-finding
// `CONFIRMED`/`STALE` field).
export function validateVerificationLegEntry(entry: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(entry)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, entry, 'direction', isNonEmptyString, 'non-empty string');
  requireField(errors, entry, 'mode', isString, 'string');
  if (isString(entry.mode)) {
    pushEnumError(errors, 'mode', entry.mode, VERIFICATION_MODES);
  }
  requireField(errors, entry, 'evidence', isNonEmptyString, 'non-empty string');

  return errors.map((error) => `${path}.${error}`);
}

export function validateVerificationLegsArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateVerificationLegEntry);
}

export function validateCompanionRepairEntry(entry: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(entry)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, entry, 'vcode', isString, 'string');
  if (isString(entry.vcode)) {
    pushEnumError(errors, 'vcode', entry.vcode, COMPANION_REPAIR_VCODES);
  }
  requireField(errors, entry, 'file', isNonEmptyString, 'non-empty string');
  requireField(errors, entry, 'action', isNonEmptyString, 'non-empty string');

  return errors.map((error) => `${path}.${error}`);
}

export function validateCompanionRepairsArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateCompanionRepairEntry);
}

export function validateConflictHunkEntry(entry: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(entry)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, entry, 'file', isNonEmptyString, 'non-empty string');
  requireField(errors, entry, 'lines', isNonEmptyString, 'non-empty string');
  requireField(errors, entry, 'excerpt', isNonEmptyString, 'non-empty string');

  return errors.map((error) => `${path}.${error}`);
}

export function validateConflictHunksArray(value: unknown, path: string): string[] {
  return validateArrayOf(value, path, validateConflictHunkEntry);
}

// Issue #492 — stop --now leg B: shared `status: partial` payload shape, dispatched identically
// by all six role validators (`worker-schemas.md` § Partial result). Mirrors the array-of-strings
// return style of `validateAcResultsArray`/`validateVisualEvidenceArray` above rather than a
// per-role reimplementation (`V-DRY-01`).
export function validatePartialResult(data: Record<string, unknown>): string[] {
  const errors: string[] = [];

  requireField(errors, data, 'phase_reached', isString, 'string');
  if (isString(data.phase_reached)) {
    pushEnumError(errors, 'phase_reached', data.phase_reached, PARTIAL_PHASES);
  }

  if (!('partial_result' in data)) {
    errors.push('partial_result: required');
    return errors;
  }
  if (!isObject(data.partial_result)) {
    errors.push('partial_result: expected object');
    return errors;
  }

  const partialResult = data.partial_result;
  const resultErrors: string[] = [];
  requireField(resultErrors, partialResult, 'work_done', isNonEmptyString, 'non-empty string');
  requireField(resultErrors, partialResult, 'work_remaining', isNonEmptyString, 'non-empty string');
  requireField(resultErrors, partialResult, 'worktree_disposition', isString, 'string');
  if (isString(partialResult.worktree_disposition)) {
    pushEnumError(resultErrors, 'worktree_disposition', partialResult.worktree_disposition, WORKTREE_DISPOSITIONS);
  }

  if (partialResult.worktree_disposition === 'pushed') {
    requireField(resultErrors, partialResult, 'branch', isNonEmptyString, 'non-empty string');
  } else if ('branch' in partialResult && partialResult.branch !== null) {
    resultErrors.push('branch: expected null when worktree_disposition is not "pushed"');
  }

  errors.push(...resultErrors.map((error) => `partial_result.${error}`));
  return errors;
}
