import { INVESTIGATOR_STATUSES, SUB_MODES } from '../constants.ts';
import {
  isConfidenceScore,
  isNumber,
  isObject,
  isString,
  pushEnumError,
  requireField,
} from '../predicates.ts';

export function validateInvestigator(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, INVESTIGATOR_STATUSES);
  }

  if (data.status === 'complete') {
    requireField(errors, data, 'note_path', isString, 'string');
    requireField(errors, data, 'sub_mode', isString, 'string');
    if (isString(data.sub_mode)) {
      pushEnumError(errors, 'sub_mode', data.sub_mode, SUB_MODES);
    }
    requireField(errors, data, 'confidence', isConfidenceScore, 'number (0-100)');
    requireField(errors, data, 'computed_at_revision', isNumber, 'number');
  } else if (data.status === 'error') {
    requireField(errors, data, 'error', isString, 'string');
  }

  return errors;
}
