import { isNonEmptyString, isObject, requireField } from './worker-json/predicates.ts';

/** Planner worker JSON `reformulation` subfield names (issue #456). */
export const REFORMULATION_FIELD_UNDERSTOOD = 'understood' as const;
export const REFORMULATION_FIELD_ASSUMED = 'assumed' as const;
export const REFORMULATION_FIELD_IF_WRONG = 'if_wrong' as const;

export const REFORMULATION_FIELDS = [
  REFORMULATION_FIELD_UNDERSTOOD,
  REFORMULATION_FIELD_ASSUMED,
  REFORMULATION_FIELD_IF_WRONG,
] as const;

/** Markdown `###` headings for the async veto-surface issue comment. */
export const REFORMULATION_HEADING_UNDERSTOOD = 'What we understood' as const;
export const REFORMULATION_HEADING_ASSUMED = 'What we assumed' as const;
export const REFORMULATION_HEADING_IF_WRONG = 'If an assumption is wrong' as const;

export type Reformulation = {
  [REFORMULATION_FIELD_UNDERSTOOD]: string;
  [REFORMULATION_FIELD_ASSUMED]: string;
  [REFORMULATION_FIELD_IF_WRONG]: string;
};

const TRACKS_REQUIRING_REFORMULATION = new Set(['quick', 'standard']);

export function validateReformulation(
  data: Record<string, unknown>,
  options: { status: string; track?: string },
  errors: string[],
): void {
  const hasReformulation = 'reformulation' in data;

  if (options.status === 'blocked') {
    if (hasReformulation) {
      errors.push('reformulation: must be absent when status is blocked');
    }
    return;
  }

  if (options.status !== 'ready') {
    return;
  }

  const track = options.track;
  if (!track || !TRACKS_REQUIRING_REFORMULATION.has(track)) {
    return;
  }

  if (!hasReformulation) {
    errors.push('reformulation: required when status is ready and track is quick or standard');
    return;
  }

  if (!isObject(data.reformulation)) {
    errors.push('reformulation: expected object');
    return;
  }

  const reformulation = data.reformulation;
  requireField(errors, reformulation, REFORMULATION_FIELD_UNDERSTOOD, isNonEmptyString, 'non-empty string');
  requireField(errors, reformulation, REFORMULATION_FIELD_ASSUMED, isNonEmptyString, 'non-empty string');
  requireField(errors, reformulation, REFORMULATION_FIELD_IF_WRONG, isNonEmptyString, 'non-empty string');
}

export function formatReformulationComment(reformulation: Reformulation): string {
  return [
    `### ${REFORMULATION_HEADING_UNDERSTOOD}`,
    '',
    reformulation[REFORMULATION_FIELD_UNDERSTOOD],
    '',
    `### ${REFORMULATION_HEADING_ASSUMED}`,
    '',
    reformulation[REFORMULATION_FIELD_ASSUMED],
    '',
    `### ${REFORMULATION_HEADING_IF_WRONG}`,
    '',
    reformulation[REFORMULATION_FIELD_IF_WRONG],
  ].join('\n');
}
