'use strict';

/**
 * tier-dispatch.js — the single tier dispatch validate-bash-command.js's main() routes every guard
 * verdict (`{ tier, pattern_id, reason }`) through. Lives here rather than inline in the validator
 * so its `allowedTiers` ceiling can be exercised with stub verdicts: the validator runs main() at
 * module load and its recorders exit the process, so it cannot be required in-process.
 */

const BLOCK_ONLY = ['block'];
const WARN_ONLY = ['warn'];
const BLOCK_OR_WARN = ['block', 'warn'];

/** Returns `handleTieredResult(verdict, { tool, command, allowedTiers })`, which records and emits
 * the verdict through `recorderByTier[verdict.tier]` and returns true — the caller then returns.
 * Returns false, recording nothing, for a null verdict or any tier outside `allowedTiers`
 * (including `'allow'`), so the caller falls through to the next check. `allowedTiers` is the
 * ceiling each call site declares for its evaluator: a tier it omits can never be emitted from
 * that site, whatever the evaluator returns. */
const createTierDispatch = (hook, recorderByTier) => (verdict, { tool, command, allowedTiers }) => {
  if (!verdict || !allowedTiers.includes(verdict.tier)) return false;
  recorderByTier[verdict.tier]({
    hook,
    tool,
    pattern_id: verdict.pattern_id,
    reason: verdict.reason,
    detail: command,
  });
  return true;
};

module.exports = { createTierDispatch, BLOCK_ONLY, WARN_ONLY, BLOCK_OR_WARN };
