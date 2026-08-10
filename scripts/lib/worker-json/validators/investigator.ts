import { ESCALATION_TRIGGERS, INVESTIGATOR_STATUSES, SUB_MODES } from '../constants.ts';
import {
  isConfidenceScore,
  isNumber,
  isObject,
  isString,
  pushEnumError,
  requireField,
} from '../predicates.ts';

// `complete` and `blocked` share the same note-file shape — the investigator always writes
// exactly one note per invocation regardless of whether a root cause was confirmed
// (investigator.md § Note schema), so both statuses require the same core fields.
function validateInvestigatorCoreFields(data: Record<string, unknown>, errors: string[]): void {
  requireField(errors, data, 'note_path', isString, 'string');
  requireField(errors, data, 'sub_mode', isString, 'string');
  if (isString(data.sub_mode)) {
    pushEnumError(errors, 'sub_mode', data.sub_mode, SUB_MODES);
  }
  requireField(errors, data, 'confidence', isConfidenceScore, 'number (0-100)');
  requireField(errors, data, 'computed_at_revision', isNumber, 'number');
}

// `escalation_trigger` is optional even on `blocked` — absent on the bounded second
// exhaustion (investigator.md § `investigate` sub-mode Escalation), present only on the
// first hypothesis-set exhaustion that the orchestrator escalates.
function validateInvestigatorBlockedFields(data: Record<string, unknown>, errors: string[]): void {
  if ('escalation_trigger' in data) {
    if (!isString(data.escalation_trigger)) {
      errors.push('escalation_trigger: expected string');
    } else {
      pushEnumError(errors, 'escalation_trigger', data.escalation_trigger, ESCALATION_TRIGGERS);
    }
  }
}

export function validateInvestigator(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, INVESTIGATOR_STATUSES);
  }

  if (data.status === 'complete' || data.status === 'blocked') {
    validateInvestigatorCoreFields(data, errors);
  }
  if (data.status === 'blocked') {
    validateInvestigatorBlockedFields(data, errors);
  }
  if (data.status === 'error') {
    requireField(errors, data, 'error', isString, 'string');
  }

  return errors;
}
