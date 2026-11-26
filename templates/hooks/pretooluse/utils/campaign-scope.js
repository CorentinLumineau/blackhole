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
 * Path traversal, system paths, destructive-command patterns and
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

/** The only callers that run the campaign rather than work in it. Claude Code sets `agent_type`
 * only inside a subagent, so the main session has none; an empty or non-string value on a payload
 * that carries the field is never the main session. */
const ORCHESTRATOR_AGENT_TYPES = new Set(['orchestrator', 'coordinator']);

/** True for an `orchestrator`/`coordinator` agent, bare or plugin-prefixed: the one named caller
 * class allowed to write campaign state dirs of main clones from a linked-worktree cwd
 * (`orchestratorStateRoots`). Every worker type, and an unknown type such as `general-purpose`, is
 * not. An absent `agent_type` is no grant here: an in-process teammate worker carries none either,
 * so that case is decided by where the call runs (`isMainSessionCwd` in `hook-event-log.js`). */
const isOrchestratorCaller = (agentType) => ORCHESTRATOR_AGENT_TYPES.has(bareAgentType(agentType));

/** True when the payload carries no `agent_type`: the main session or an in-process teammate. */
const hasNoAgentType = (agentType) => agentType === undefined || agentType === null;

/**
 * @param {{ agent_type?: unknown }} input hook payload
 * @param {string | null} assignedRoot result of readAssignedWorktreeRoot(cwd) — the caller already
 *   computes it, and it may throw, so this module never calls git itself
 * @param {Record<string, string | undefined>} env
 */
const isCampaignScoped = (input, assignedRoot, env = process.env) =>
  env.BLACKHOLE_HOOK_SCOPE === 'all' || isCampaignAgentType(input && input.agent_type) || Boolean(assignedRoot);

module.exports = { CAMPAIGN_AGENT_TYPES, isCampaignAgentType, isOrchestratorCaller, hasNoAgentType, isCampaignScoped };
