import {
  BRAINSTORM_CHILDREN_CAP,
  PLAN_MODES,
  PLANNER_STATUSES,
  RULING_DISPOSITIONS,
  SIZE_ESTIMATES,
  TASK_TYPES,
  TRACKS,
} from '../constants.ts';
import {
  isGainEffortScore,
  isNonEmptyString,
  isNumber,
  isObject,
  isString,
  isStringArray,
  pushEnumError,
  requireField,
} from '../predicates.ts';

// Issue #422 — ruling watermark + phase-gate re-validation. `R-NNN` is #417's stable per-ruling
// citation handle, never the kebab slug.
const RULING_ID_PATTERN = /^R-\d{3}$/;

function validateRulingConflictEntry(entry: unknown, index: number): string[] {
  const errors: string[] = [];

  if (!isObject(entry)) {
    errors.push(`ruling_conflicts[${index}]: expected object`);
    return errors;
  }

  requireField(errors, entry, 'ruling_id', isNonEmptyString, 'non-empty string');
  if (isNonEmptyString(entry.ruling_id) && !RULING_ID_PATTERN.test(entry.ruling_id)) {
    errors.push('ruling_id: expected format R-NNN (e.g. "R-007")');
  }

  requireField(errors, entry, 'summary', isNonEmptyString, 'non-empty string');

  requireField(errors, entry, 'suggested_disposition', isString, 'string');
  if (isString(entry.suggested_disposition)) {
    pushEnumError(errors, 'suggested_disposition', entry.suggested_disposition, RULING_DISPOSITIONS);
  }

  return errors.map((error) => `ruling_conflicts[${index}].${error}`);
}

// Both fields are optional (§ Database/API Schema Changes, plan issue-422): `rulings_checked_at`
// present without `ruling_conflicts` is invalid — it is what distinguishes "read the ledger and
// found nothing" (both present, conflicts possibly empty) from "did not read the ledger" (both
// absent).
function validateRulingConflicts(data: Record<string, unknown>, errors: string[]): void {
  if ('rulings_checked_at' in data) {
    requireField(errors, data, 'rulings_checked_at', isNumber, 'number');
    if (!('ruling_conflicts' in data)) {
      errors.push('ruling_conflicts: required when rulings_checked_at is present');
    }
  }

  if ('ruling_conflicts' in data) {
    if (!Array.isArray(data.ruling_conflicts)) {
      errors.push('ruling_conflicts: expected array');
    } else {
      data.ruling_conflicts.forEach((entry, index) => {
        errors.push(...validateRulingConflictEntry(entry, index));
      });
    }
  }
}

export function validateBrainstormChild(child: unknown, index: number): string[] {
  const errors: string[] = [];

  if (!isObject(child)) {
    errors.push(`children[${index}]: expected object`);
    return errors;
  }

  requireField(errors, child, 'title', isNonEmptyString, 'non-empty string');
  requireField(errors, child, 'body', isNonEmptyString, 'non-empty string');

  if (!('acceptance_criteria' in child)) {
    errors.push('acceptance_criteria: required');
  } else if (!isStringArray(child.acceptance_criteria) || child.acceptance_criteria.length === 0) {
    errors.push('acceptance_criteria: expected non-empty string[]');
  }

  requireField(errors, child, 'size_estimate', isString, 'string');
  if (isString(child.size_estimate)) {
    pushEnumError(errors, 'size_estimate', child.size_estimate, SIZE_ESTIMATES);
  }

  if (!('suggested_route' in child)) {
    errors.push('suggested_route: required');
  } else if (!isObject(child.suggested_route)) {
    errors.push('suggested_route: expected object');
  } else {
    requireField(errors, child.suggested_route, 'task_type', isString, 'string');
    if (isString(child.suggested_route.task_type)) {
      pushEnumError(errors, 'suggested_route.task_type', child.suggested_route.task_type, TASK_TYPES);
    }
    requireField(errors, child.suggested_route, 'plan_mode', isString, 'string');
    if (isString(child.suggested_route.plan_mode)) {
      pushEnumError(errors, 'suggested_route.plan_mode', child.suggested_route.plan_mode, PLAN_MODES);
    }
  }

  requireField(errors, child, 'gain', isGainEffortScore, 'number (1-10)');
  requireField(errors, child, 'effort', isGainEffortScore, 'number (1-10)');

  return errors.map((error) => `children[${index}].${error}`);
}

function validatePlannerReadyBrainstormFields(data: Record<string, unknown>, errors: string[]): void {
  requireField(errors, data, 'artifact_path', isString, 'string');
  if (!('children' in data)) {
    errors.push('children: required');
  } else if (!Array.isArray(data.children)) {
    errors.push('children: expected array');
  } else {
    if (data.children.length > BRAINSTORM_CHILDREN_CAP) {
      errors.push(
        `children: at most ${BRAINSTORM_CHILDREN_CAP} proposed children allowed (got ${data.children.length})`,
      );
    }
    data.children.forEach((child, index) => {
      errors.push(...validateBrainstormChild(child, index));
    });
  }
}

function validatePlannerReadyFields(data: Record<string, unknown>, errors: string[]): void {
  requireField(errors, data, 'plan_path', isString, 'string');
  requireField(errors, data, 'track', isString, 'string');
  if (isString(data.track)) {
    pushEnumError(errors, 'track', data.track, TRACKS);
  }
  if (data.track === 'design') {
    errors.push('track: design track must never report status ready (ADR-004: design is always blocked)');
  }
  if (data.track === 'brainstorm') {
    validatePlannerReadyBrainstormFields(data, errors);
  }
  if (!Array.isArray(data.failing_checks)) {
    errors.push('failing_checks: expected array');
  }
  requireField(errors, data, 'clarification_markers', isNumber, 'number');
  validateRulingConflicts(data, errors);
}

function validatePlannerBlockedDesignFields(data: Record<string, unknown>, errors: string[]): void {
  requireField(errors, data, 'plan_path', isString, 'string');
}

function validatePlannerBlockedBrainstormFields(data: Record<string, unknown>, errors: string[]): void {
  requireField(errors, data, 'blocking_question', isNonEmptyString, 'non-empty string');
}

function validatePlannerBlockedFields(data: Record<string, unknown>, errors: string[]): void {
  if (!isStringArray(data.failing_checks)) {
    errors.push('failing_checks: expected string[]');
  }
  requireField(errors, data, 'clarification_markers', isNumber, 'number');
  if ('track' in data) {
    if (!isString(data.track)) {
      errors.push('track: expected string');
    } else {
      pushEnumError(errors, 'track', data.track, TRACKS);
      if (data.track === 'design') {
        validatePlannerBlockedDesignFields(data, errors);
      }
      if (data.track === 'brainstorm') {
        validatePlannerBlockedBrainstormFields(data, errors);
      }
    }
  }
  validateRulingConflicts(data, errors);
}

export function validatePlanner(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, PLANNER_STATUSES);
  }

  if (data.status === 'ready') {
    validatePlannerReadyFields(data, errors);
  } else if (data.status === 'blocked') {
    validatePlannerBlockedFields(data, errors);
  }

  return errors;
}
