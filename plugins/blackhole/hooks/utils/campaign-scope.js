#!/usr/bin/env bun
'use strict';

/**
 * campaign-scope.js — decides whether a tool call belongs to a campaign worker, the only caller
 * the containment guards exist for (ADR-047).
 *
 * The write-containment and main-clone guards were written for unattended campaign workers. Run
 * on every session in a repo that has a campaign, they also refused an ordinary interactive
 * session's writes outside the repo (a shared project folder, a scratchpad) and its everyday git
 * commands in the main clone. A call is campaign-scoped when any of these hold:
 *
 *   1. `agent_type` names a blackhole campaign agent, bare or plugin-prefixed (`implementer`,
 *      `blackhole:implementer`). Claude Code sets it only inside a subagent.
 *   2. The call already has an assigned worktree: `BLACKHOLE_ASSIGNED_WORKTREE`, or a `cwd` inside
 *      a linked worktree (ADR-045). A worker spawned under some other agent type still lands here,
 *      because workers run in linked worktrees.
 *   3. `BLACKHOLE_HOOK_SCOPE=all` restores the previous behaviour for every session.
 *
 * Path traversal, system paths, destructive-command patterns, worktree-removal safety and
 * sensitive-file warnings stay on for every session; only containment is scoped.
 */

/** Must match AGENT_NAMES in scripts/lib/build/facts.ts (pinned by a test there). */
const CAMPAIGN_AGENT_TYPES = new Set([
  'coordinator',
  'orchestrator',
  'planner',
  'implementer',
  'reviewer',
  'router',
  'investigator',
  'hunter',
]);

/** `blackhole:implementer` → `implementer`; anything that is not a non-empty string → null. */
const bareAgentType = (agentType) => {
  if (typeof agentType !== 'string' || !agentType) return null;
  const idx = agentType.lastIndexOf(':');
  return idx === -1 ? agentType : agentType.slice(idx + 1);
};

const isCampaignAgentType = (agentType) => CAMPAIGN_AGENT_TYPES.has(bareAgentType(agentType));

/**
 * @param {{ agent_type?: unknown }} input hook payload
 * @param {string | null} assignedRoot result of readAssignedWorktreeRoot(cwd) — the caller already
 *   computes it, and it may throw, so this module never calls git itself
 * @param {Record<string, string | undefined>} env
 */
const isCampaignScoped = (input, assignedRoot, env = process.env) =>
  env.BLACKHOLE_HOOK_SCOPE === 'all' || isCampaignAgentType(input && input.agent_type) || Boolean(assignedRoot);

module.exports = { CAMPAIGN_AGENT_TYPES, isCampaignAgentType, isCampaignScoped };
