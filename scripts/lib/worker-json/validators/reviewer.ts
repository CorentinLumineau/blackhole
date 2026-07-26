import { REVIEWER_STATUSES } from '../constants.ts';
import { isObject, isString, pushEnumError, requireField } from '../predicates.ts';
import { validateFindingsArray } from '../shared-validators.ts';

export function validateReviewer(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, REVIEWER_STATUSES);
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
