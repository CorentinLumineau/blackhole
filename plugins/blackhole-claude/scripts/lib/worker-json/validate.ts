import { extractWorkerJson } from './extract.ts';
import { hasAssistantTurn, readTranscriptTail, transcriptReturnCandidates } from './transcript.ts';
import type { HookInput, Role } from './types.ts';
import { validateHunter } from './validators/hunter.ts';
import { validateImplementer } from './validators/implementer.ts';
import { validateInvestigator } from './validators/investigator.ts';
import { validatePlanner } from './validators/planner.ts';
import { validateReviewer } from './validators/reviewer.ts';
import { validateRouter } from './validators/router.ts';

export function validateWorker(role: Role, data: unknown): string[] {
  switch (role) {
    case 'planner':
      return validatePlanner(data);
    case 'implementer':
      return validateImplementer(data);
    case 'reviewer':
      return validateReviewer(data);
    case 'router':
      return validateRouter(data);
    case 'investigator':
      return validateInvestigator(data);
    case 'hunter':
      return validateHunter(data);
    default:
      return [`role: unsupported role "${role as string}"`];
  }
}

export function extractFromHookInput(input: HookInput): unknown {
  const summary = input.summary ?? '';

  try {
    return extractWorkerJson(summary);
  } catch {
    // fall through to transcript scan
  }

  if (input.agent_transcript_path) {
    const tail = readTranscriptTail(input.agent_transcript_path);
    if (tail) {
      // A JSONL transcript holds the return as an escaped string inside an envelope line, so
      // read it out of the last assistant turn; scanning the raw tail would return an envelope.
      // Only a tail with no assistant envelope at all is scanned as plain text.
      const candidates = hasAssistantTurn(tail) ? transcriptReturnCandidates(tail) : [tail];
      for (const text of candidates) {
        try {
          return extractWorkerJson(text);
        } catch {
          // try the next candidate
        }
      }
    }
  }

  throw new Error('no worker JSON found in summary or transcript');
}
