import {
  ESCALATION_TRIGGERS,
  EXECUTION_MODES,
  IMPLEMENTER_STATUSES,
  SPRINT_CONTRACT_STATUSES,
  TASK_TYPES,
} from '../constants.ts';
import {
  isBoolean,
  isEvidence,
  isNumber,
  isNumberArray,
  isObject,
  isString,
  pushEnumError,
  requireField,
} from '../predicates.ts';
import {
  validateAcResultsArray,
  validateCompanionRepairsArray,
  validateConflictHunksArray,
  validateDecisionRecordsArray,
  validatePartialResult,
  validateVisualEvidenceArray,
} from '../shared-validators.ts';

function validateImplementerCompleteFields(data: Record<string, unknown>, errors: string[]): void {
  requireField(errors, data, 'pr_number', isNumber, 'number');
  requireField(errors, data, 'branch', isString, 'string');
  requireField(errors, data, 'tests_passed', isBoolean, 'boolean');
  requireField(errors, data, 'touch_paths_honored', isBoolean, 'boolean');
  requireField(
    errors,
    data,
    'evidence',
    isEvidence,
    'object { command: string, result: string } with non-empty command and result',
  );
  if ('execution_mode' in data) {
    if (!isString(data.execution_mode)) {
      errors.push('execution_mode: expected string');
    } else {
      pushEnumError(errors, 'execution_mode', data.execution_mode, EXECUTION_MODES);
    }
  }
}

function validateImplementerBlockedFields(data: Record<string, unknown>, errors: string[]): void {
  if ('escalation_trigger' in data) {
    if (!isString(data.escalation_trigger)) {
      errors.push('escalation_trigger: expected string');
    } else {
      pushEnumError(errors, 'escalation_trigger', data.escalation_trigger, ESCALATION_TRIGGERS);
      if (data.escalation_trigger === 'merge_conflict_semantic') {
        if (!Array.isArray(data.conflict_hunks) || data.conflict_hunks.length === 0) {
          errors.push(
            'conflict_hunks: required non-empty array when escalation_trigger is merge_conflict_semantic',
          );
        }
      }
    }
  }
}

function validateImplementerOptionalFields(data: Record<string, unknown>, errors: string[]): void {
  if ('task_type' in data) {
    if (!isString(data.task_type)) {
      errors.push('task_type: expected string');
    } else {
      pushEnumError(errors, 'task_type', data.task_type, TASK_TYPES);
    }
  }

  if ('new_findings' in data && data.new_findings !== undefined && !Array.isArray(data.new_findings)) {
    errors.push('new_findings: expected array');
  }

  if ('filed_issues' in data && data.filed_issues !== undefined && !isNumberArray(data.filed_issues)) {
    errors.push('filed_issues: expected number[]');
  }

  if ('decision_records' in data && data.decision_records !== undefined) {
    errors.push(...validateDecisionRecordsArray(data.decision_records, 'decision_records'));
  }

  if ('sprint_contract_status' in data) {
    if (!isString(data.sprint_contract_status)) {
      errors.push('sprint_contract_status: expected string');
    } else {
      pushEnumError(errors, 'sprint_contract_status', data.sprint_contract_status, SPRINT_CONTRACT_STATUSES);
      if (data.sprint_contract_status !== 'N/A') {
        if (!Array.isArray(data.ac_results) || data.ac_results.length === 0) {
          errors.push('ac_results: required non-empty array when sprint_contract_status is not N/A');
        }
      }
    }
  }

  if ('ac_results' in data && data.ac_results !== undefined) {
    errors.push(...validateAcResultsArray(data.ac_results, 'ac_results'));
  }

  if ('visual_evidence' in data && data.visual_evidence !== undefined) {
    errors.push(...validateVisualEvidenceArray(data.visual_evidence, 'visual_evidence'));
  }

  if ('companion_repairs' in data && data.companion_repairs !== undefined) {
    errors.push(...validateCompanionRepairsArray(data.companion_repairs, 'companion_repairs'));
  }

  if ('conflict_hunks' in data && data.conflict_hunks !== undefined) {
    errors.push(...validateConflictHunksArray(data.conflict_hunks, 'conflict_hunks'));
  }
}

export function validateImplementer(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, IMPLEMENTER_STATUSES);
  }

  if (data.status === 'complete') {
    validateImplementerCompleteFields(data, errors);
  }

  if (data.status === 'blocked') {
    validateImplementerBlockedFields(data, errors);
  }

  // Issue #492 — stop --now leg B: a completed worker's answer to the Flush Request
  // (`worker-schemas.md` § Partial result), structurally exclusive with `complete`/`blocked`.
  if (data.status === 'partial') {
    errors.push(...validatePartialResult(data));
  }

  validateImplementerOptionalFields(data, errors);

  return errors;
}
