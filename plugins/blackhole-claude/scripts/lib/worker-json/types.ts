export type Role = 'planner' | 'implementer' | 'reviewer' | 'router' | 'investigator' | 'hunter';

export type HookInput = {
  subagent_type?: string;
  description?: string;
  task?: string;
  status?: string;
  summary?: string;
  agent_transcript_path?: string;
};
