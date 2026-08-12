import { ESCALATION_TRIGGERS, INVESTIGATOR_STATUSES, SUB_MODES } from '../constants.ts';
import {
  isConfidenceScore,
  isNumber,
  isObject,
  isString,
  pushEnumError,
  requireField,
} from '../predicates.ts';
import { validatePartialResult } from '../shared-validators.ts';

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

// `escalation_trigger` is always present on `blocked` — the investigator sets it identically
// on every hypothesis-set exhaustion and never tracks its own escalation history
// (investigator.md § `investigate` sub-mode Escalation). Whether the orchestrator escalates
// again or blocks the issue is state it alone tracks via `queue.json` notes, invisible here
// (`orchestrator-dispatch.md` § Investigator Escalation Dispatch).
function validateInvestigatorBlockedFields(data: Record<string, unknown>, errors: string[]): void {
  requireField(errors, data, 'escalation_trigger', isString, 'string');
  if (isString(data.escalation_trigger)) {
    pushEnumError(errors, 'escalation_trigger', data.escalation_trigger, ESCALATION_TRIGGERS);
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
  if (data.status === 'partial') {
    // Issue #492 — stop --now leg B (`worker-schemas.md` § Partial result).
    errors.push(...validatePartialResult(data));
  }

  return errors;
}
