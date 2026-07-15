import * as path from 'path';
import { readJsonFile } from './lib/fs.ts';

export type CampaignScope = {
  milestone?: string;
  labels?: string[];
};

export type ForgeIssue = {
  milestone?: { title: string } | null;
  labels?: { name: string }[];
};

type CampaignConfig = {
  scope_milestone?: string;
  scope_labels?: string[];
  issue_labels?: { campaign?: string };
};

const DEFAULT_CONFIG_PATH = '.blackhole/config.json';

export function readScope(config: CampaignConfig): CampaignScope {
  const scope: CampaignScope = {};

  if (config.scope_milestone) {
    scope.milestone = config.scope_milestone;
  }

  if (config.scope_labels && config.scope_labels.length > 0) {
    scope.labels = [...config.scope_labels];
  }

  return scope;
}

export function buildListArgs(scope: CampaignScope): string[] {
  const args: string[] = [];

  if (scope.milestone) {
    args.push('--milestone', scope.milestone);
  }

  if (scope.labels) {
    for (const label of scope.labels) {
      args.push('--label', label);
    }
  }

  return args;
}

export function buildCreateArgs(scope: CampaignScope): string[] {
  return buildListArgs(scope);
}

export function issueMatchesScope(issue: ForgeIssue, scope: CampaignScope): boolean {
  if (scope.milestone) {
    const title = issue.milestone?.title;
    if (title !== scope.milestone) return false;
  }

  if (scope.labels && scope.labels.length > 0) {
    const issueLabels = new Set((issue.labels ?? []).map((l) => l.name));
    for (const required of scope.labels) {
      if (!issueLabels.has(required)) return false;
    }
  }

  return true;
}

/** Merge campaign label from config when not already in scope_labels. */
export function buildCreateArgsWithCampaignLabel(
  config: CampaignConfig,
): string[] {
  const scope = readScope(config);
  const args = buildCreateArgs(scope);
  const campaignLabel = config.issue_labels?.campaign;

  if (campaignLabel) {
    const inScope = scope.labels?.includes(campaignLabel);
    if (!inScope) {
      args.push('--label', campaignLabel);
    }
  }

  return args;
}

function resolveConfigPath(): string {
  if (process.env.CAMPAIGN_CONFIG) {
    return process.env.CAMPAIGN_CONFIG;
  }
  return path.join(process.cwd(), DEFAULT_CONFIG_PATH);
}

function loadConfig(): CampaignConfig {
  const configPath = resolveConfigPath();
  return readJsonFile(configPath, configPath) as CampaignConfig;
}

if (import.meta.main) {
  const cmd = process.argv[2];

  if (cmd === 'list-args') {
    const config = loadConfig();
    const args = buildListArgs(readScope(config));
    console.log(args.join(' '));
  } else if (cmd === 'create-args') {
    const config = loadConfig();
    const args = buildCreateArgsWithCampaignLabel(config);
    console.log(args.join(' '));
  } else {
    console.error('Usage: bun scripts/forge-scope.ts <list-args|create-args>');
    process.exit(1);
  }
}
