'use strict';

/**
 * oversize-command.js — the size and nesting refusals shared by every Bash guard that scans a
 * command. The native wrapper fails OPEN on its 5 s hook timeout, so an input too large to verify
 * in time is refused here rather than analysed.
 */

/** Largest command, in characters, the Bash hook will analyse; above it the hook fails CLOSED
 * (`oversizeCommandDecision`). Applies to EVERY session, not only campaign workers: the static
 * pattern matchers run for all of them and one (fork-bomb) backtracks quadratically. 32 KiB sits
 * above the longest of 12,893 observed real Bash calls (18,722 characters); larger file bodies
 * belong in the Write tool. */
const MAX_ANALYZABLE_COMMAND_CHARS = 32 * 1024;

const SPLIT_REMEDY =
  'Remedy: split this into several smaller Bash calls (write large file bodies with the Write ' +
  'tool instead of a heredoc).';

/** Block decision for a command above `MAX_ANALYZABLE_COMMAND_CHARS`, or null. The one place the
 * size limit is enforced, so no guard pays any scan cost before it. */
const oversizeCommandDecision = (command) =>
  command.length > MAX_ANALYZABLE_COMMAND_CHARS
    ? {
        tier: 'block',
        pattern_id: 'command-too-large-to-verify',
        reason:
          `Command is ${command.length} characters, above the ${MAX_ANALYZABLE_COMMAND_CHARS}-character ` +
          `limit the Bash guards can verify in time — refused fail-closed. ${SPLIT_REMEDY}`,
      }
    : null;

/** Block decision for a command whose clause nesting exceeded the scanner's budget. */
const scanBudgetExceededDecision = () => ({
  tier: 'block',
  pattern_id: 'command-too-complex-to-verify',
  reason:
    'Command nests clauses too deeply for the Bash guards to verify in time — ' +
    `refused fail-closed. ${SPLIT_REMEDY}`,
});

module.exports = { MAX_ANALYZABLE_COMMAND_CHARS, oversizeCommandDecision, scanBudgetExceededDecision };
