// Run context (ADR-046): what the current run can actually do, and the one routing table that
// turns it into a campaign shape. Detection reads what the environment shows; the agent adds what
// only it can see (its own tool list). Every field records which of the two it came from, so a
// resolved route can always be traced back to evidence.

export type Host = 'claude' | 'cursor' | 'unknown';
export type Surface = 'local' | 'cloud' | 'project-thread' | 'headless';
export type Source = 'env' | 'probe' | 'agent' | 'derived';
export type Fact<T> = { value: T; source: Source };

/** Tools the agent reports from its own tool list. Nothing else can see them. */
export const AGENT_TOOLS = [
  'workflow', // Claude Code Workflow tool (deterministic fan-out)
  'agent', // Agent / Task subagent spawning
  'background-agents', // completion notifications for background subagents
  'ask-user-question', // Claude Code AskUserQuestion
  'ask-question', // Cursor AskQuestion / cursor/ask_question
  'ask-decision', // Claude Project decision card
  'github-mcp', // GitHub MCP tools (mcp__github__*)
  'pr-subscriptions', // PR activity events delivered into the session
  'routines', // scheduled triggers the session can create
] as const;
export type AgentTool = (typeof AGENT_TOOLS)[number];

export type ForgeChannel = 'gh' | 'rest' | 'mcp';
export type QuestionChannel = 'ask-decision' | 'ask-user-question' | 'ask-question' | 'chat' | 'none';

export type RunContext = {
  host: Fact<Host>;
  surface: Fact<Surface>;
  persistent_disk: Fact<boolean>;
  forge_channels: Fact<ForgeChannel[]>;
  question_channel: Fact<QuestionChannel>;
  fan_out: Fact<'workflow' | 'agent' | 'none'>;
  completion_events: Fact<boolean>;
  pr_events: Fact<boolean>;
  scheduler: Fact<'routines' | 'none'>;
};

export type Pattern = 'B' | 'C' | 'C-lite';
export type RunRoute = {
  pattern: Pattern;
  forge_channel: ForgeChannel | null;
  question_channel: QuestionChannel;
  ci_wait: 'pr-events' | 'poll';
  state_store: 'local' | 'branch';
  /** Capabilities the campaign cannot start without; bootstrap refuses while non-empty. */
  missing: string[];
  /** Degradations that do not block a start, each stated once. */
  warnings: string[];
};

export type Probes = { ghAuthenticated: boolean };
export type Overrides = Partial<{ host: Host; surface: Surface; persistentDisk: boolean }>;

const fact = <T>(value: T, source: Source): Fact<T> => ({ value, source });

const detectHost = (env: Record<string, string | undefined>): Host => {
  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return 'cursor';
  return 'unknown';
};

const detectSurface = (env: Record<string, string | undefined>): Surface => {
  if (env.CLAUDE_CODE_PROJECTS_SESSION === '1') return 'project-thread';
  if (env.CLAUDE_CODE_REMOTE === 'true') return 'cloud';
  if (env.CLAUDE_CODE_ENTRYPOINT?.startsWith('sdk')) return 'headless';
  return 'local';
};

const pickQuestionChannel = (tools: Set<AgentTool>, surface: Surface): QuestionChannel => {
  if (tools.has('ask-decision')) return 'ask-decision';
  if (tools.has('ask-user-question')) return 'ask-user-question';
  if (tools.has('ask-question')) return 'ask-question';
  // Nobody reads a headless run's chat, so a question there could only stall the campaign.
  return surface === 'headless' ? 'none' : 'chat';
};

/** Builds the run context from the environment, local probes and the agent's reported tools. */
export const detectRunContext = (
  env: Record<string, string | undefined>,
  probes: Probes,
  tools: AgentTool[],
  overrides: Overrides = {},
): RunContext => {
  const toolSet = new Set(tools);
  const host = overrides.host ? fact(overrides.host, 'agent') : fact(detectHost(env), 'env');
  const surface = overrides.surface ? fact(overrides.surface, 'agent') : fact(detectSurface(env), 'env');
  // Cloud and Project containers, and CI runners, are reclaimed after the run.
  const persistentDisk = overrides.persistentDisk !== undefined
    ? fact(overrides.persistentDisk, 'agent')
    : fact(surface.value === 'local' || (surface.value === 'headless' && env.CI !== 'true'), 'derived');

  const channels: ForgeChannel[] = [];
  if (probes.ghAuthenticated) channels.push('gh');
  if (env.GH_TOKEN || env.GITHUB_TOKEN) channels.push('rest');
  if (toolSet.has('github-mcp')) channels.push('mcp');
  const fanOut = toolSet.has('workflow') ? 'workflow' : toolSet.has('agent') ? 'agent' : 'none';

  return {
    host,
    surface,
    persistent_disk: persistentDisk,
    forge_channels: fact(channels, toolSet.has('github-mcp') ? 'agent' : 'probe'),
    question_channel: fact(pickQuestionChannel(toolSet, surface.value), 'agent'),
    fan_out: fact(fanOut, 'agent'),
    completion_events: fact(toolSet.has('background-agents'), 'agent'),
    pr_events: fact(toolSet.has('pr-subscriptions'), 'agent'),
    scheduler: fact(toolSet.has('routines') ? 'routines' : 'none', 'agent'),
  };
};

/**
 * The routing table (ADR-046, run-context.md). Pattern C needs fan-out, completion events and a
 * question channel (C1-C3 in claude-code-native.md); Cursor's version of that is C-lite;
 * anything less is Pattern B.
 */
export const routeRunContext = (ctx: RunContext): RunRoute => {
  const missing: string[] = [];
  const warnings: string[] = [];
  if (ctx.host.value === 'unknown') missing.push('host: pass --host claude|cursor');
  if (ctx.fan_out.value === 'none') missing.push('fan-out: an Agent/Task or Workflow tool to spawn workers');
  const forge = (['gh', 'rest', 'mcp'] as const).find((c) => ctx.forge_channels.value.includes(c)) ?? null;
  if (!forge) missing.push('forge: an authenticated gh, a GitHub token, or GitHub MCP tools');
  if (forge && forge !== 'gh') warnings.push(`forge: gh is not authenticated; steps that shell out to gh fail until they gain a ${forge} path`);

  // C3 (a foreground question channel) is the third precondition; chat counts, nobody does not.
  const nativeFanOut = ctx.fan_out.value !== 'none' && ctx.completion_events.value && ctx.question_channel.value !== 'none';
  const pattern: Pattern = !nativeFanOut ? 'B' : ctx.host.value === 'cursor' ? 'C-lite' : 'C';

  if (ctx.question_channel.value === 'none') {
    warnings.push('questions: no channel reaches a person; clarify gates leave the issue blocked');
  }
  const stateStore = ctx.persistent_disk.value ? 'local' : 'branch';
  if (stateStore === 'branch') {
    warnings.push('state: the disk does not persist; push .blackhole/ to a branch before the session ends');
  }
  return {
    pattern,
    forge_channel: forge,
    question_channel: ctx.question_channel.value,
    ci_wait: ctx.pr_events.value ? 'pr-events' : 'poll',
    state_store: stateStore,
    missing,
    warnings,
  };
};
