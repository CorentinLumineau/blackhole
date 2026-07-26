import { ROLE_FROM_TYPE, ROLE_PATTERN } from './constants.ts';
import type { HookInput, Role } from './types.ts';

export function resolveRole(input: HookInput): Role | null {
  if (input.subagent_type && input.subagent_type in ROLE_FROM_TYPE) {
    return ROLE_FROM_TYPE[input.subagent_type];
  }

  const haystack = [input.description, input.task].filter(Boolean).join(' ');
  const match = haystack.match(ROLE_PATTERN);
  if (match) {
    return match[1].toLowerCase() as Role;
  }

  return null;
}
