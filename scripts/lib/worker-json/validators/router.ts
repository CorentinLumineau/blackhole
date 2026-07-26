import { PLAN_MODES, ROUTE_STATUSES, TASK_TYPES, TRIGGERS } from '../constants.ts';
import {
  isBoolean,
  isConfidenceScore,
  isNumber,
  isObject,
  isString,
  pushEnumError,
  requireField,
} from '../predicates.ts';

export function validateRoute(route: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isObject(route)) {
    errors.push(`${path}: expected object`);
    return errors;
  }

  requireField(errors, route, 'needs_split', isBoolean, 'boolean');
  requireField(errors, route, 'needs_clarification', isBoolean, 'boolean');
  requireField(errors, route, 'needs_research', isBoolean, 'boolean');
  requireField(errors, route, 'needs_investigation', isBoolean, 'boolean');
  requireField(errors, route, 'needs_design', isBoolean, 'boolean');
  requireField(errors, route, 'needs_brainstorm', isBoolean, 'boolean');
  requireField(errors, route, 'needs_analysis', isBoolean, 'boolean');

  requireField(errors, route, 'task_type', isString, 'string');
  if (isString(route.task_type)) {
    pushEnumError(errors, `${path}.task_type`, route.task_type, TASK_TYPES);
  }

  requireField(errors, route, 'plan_mode', isString, 'string');
  if (isString(route.plan_mode)) {
    pushEnumError(errors, `${path}.plan_mode`, route.plan_mode, PLAN_MODES);
  }

  requireField(errors, route, 'security_review_required', isBoolean, 'boolean');
  requireField(errors, route, 'docs_impact', isBoolean, 'boolean');

  if (!('confidence' in route)) {
    errors.push('confidence: required');
  } else if (!isObject(route.confidence)) {
    errors.push('confidence: expected object');
  } else {
    for (const field of ['split', 'design', 'plan_mode', 'security', 'docs', 'brainstorm', 'analysis'] as const) {
      requireField(errors, route.confidence, field, isConfidenceScore, 'number (0-100)');
    }
  }

  requireField(errors, route, 'body_hash', isString, 'string');
  requireField(errors, route, 'computed_at_phase', isString, 'string');
  requireField(errors, route, 'revision', isNumber, 'number');

  return errors;
}

export function validateRouter(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(data)) {
    return ['payload: expected object'];
  }

  requireField(errors, data, 'status', isString, 'string');
  if (isString(data.status)) {
    pushEnumError(errors, 'status', data.status, ROUTE_STATUSES);
  }

  if (data.status === 'routed') {
    if (!('route' in data)) {
      errors.push('route: required');
    } else {
      errors.push(...validateRoute(data.route, 'route'));
    }
    requireField(errors, data, 'trigger', isString, 'string');
    if (isString(data.trigger)) {
      pushEnumError(errors, 'trigger', data.trigger, TRIGGERS);
    }
  } else if (data.status === 'error') {
    requireField(errors, data, 'error', isString, 'string');
  }

  return errors;
}
