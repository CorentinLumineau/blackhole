import { REVIEWER_STATUSES } from '../constants.ts';
import { isObject, isString, pushEnumError, requireField } from '../predicates.ts';
import { validateFindingsArray, validatePartialResult } from '../shared-validators.ts';

export function validateReviewer(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, REVIEWER_STATUSES);
  }

  // Issue #492 — stop --now leg B: `partial` carries `partial_result` instead of `findings`
  // (`worker-schemas.md` § Partial result — not a smaller `complete`).
  if (data.status === 'partial') {
    errors.push(...validatePartialResult(data));
    return errors;
  }

  if (!('findings' in data)) {
    errors.push('findings: required');
  } else {
    errors.push(...validateFindingsArray(data.findings, 'findings'));
  }

  if (data.status === 'error') {
    requireField(errors, data, 'error', isString, 'string');
  }

  return errors;
}
