// Issue #492 — stop --now leg B. The orchestrator's `notes` string for a `status: partial`
// worker return (`orchestrator-runtime.md` § Partial-result ingest, `worker-schemas.md` §
// Partial result). Reuses `queue.json`'s existing free-form `notes` convention
// (`queue-dag.md` § Field rules) rather than adding a new queue schema field — this is the
// codebase's single source for that string's format; `orchestrator-runtime.md`'s prose cites it
// rather than re-deriving the format independently (`V-DRY-01`).

/**
 * Builds the `partial-flush:<phase>:branch=<b|none>:disposition=<d>:remaining=<r>` `notes`
 * string for a queue entry whose worker returned `status: partial`.
 */
export function buildPartialFlushNotes(
  phaseReached: string,
  branch: string | null,
  disposition: string,
  workRemaining: string,
): string {
  const branchToken = branch ?? 'none';
  // Strip newlines — `notes` is a single-line queue field.
  const remainingToken = workRemaining.replace(/\r?\n/g, ' ').trim();
  return `partial-flush:${phaseReached}:branch=${branchToken}:disposition=${disposition}:remaining=${remainingToken}`;
}
