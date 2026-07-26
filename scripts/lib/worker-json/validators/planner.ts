import {
  BRAINSTORM_CHILDREN_CAP,
  PLAN_MODES,
  PLANNER_STATUSES,
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

export function validatePlanner(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, PLANNER_STATUSES);
  }

  const status = data.status;
  if (status === 'ready') {
    requireField(errors, data, 'plan_path', isString, 'string');
    requireField(errors, data, 'track', isString, 'string');
    if (isString(data.track)) {
      pushEnumError(errors, 'track', data.track, TRACKS);
    }
    if (data.track === 'design') {
      errors.push('track: design track must never report status ready (ADR-004: design is always blocked)');
    }
    if (data.track === 'brainstorm') {
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
    if (!Array.isArray(data.failing_checks)) {
      errors.push('failing_checks: expected array');
    }
    requireField(errors, data, 'clarification_markers', isNumber, 'number');
  } else if (status === 'blocked') {
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
          requireField(errors, data, 'plan_path', isString, 'string');
        }
        if (data.track === 'brainstorm') {
          requireField(errors, data, 'blocking_question', isNonEmptyString, 'non-empty string');
        }
      }
    }
  }

  return errors;
}
