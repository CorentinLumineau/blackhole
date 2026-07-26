import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import { parseCheckpointFrontmatter } from './checkpoint.ts';
import type { LedgerJson, QueueJson } from './types.ts';

export function loadCampaignState(campaignDir: string) {
  const configPath = path.join(campaignDir, 'config.json');
  const queuePath = path.join(campaignDir, 'queue.json');
  const ledgerPath = path.join(campaignDir, 'findings-ledger.json');
  const checkpointPath = path.join(campaignDir, 'campaign-checkpoint.md');

  const config = readJsonFile(configPath, configPath) as {
    repo?: string;
    scope_milestone?: string;
    scope_labels?: string[];
  };
  const queue = readJsonFile(queuePath, queuePath) as QueueJson;
  const ledger = readJsonFile(ledgerPath, ledgerPath) as LedgerJson;

  let checkpoint: ReturnType<typeof parseCheckpointFrontmatter> = {};
  let checkpointBody = '';
  if (fs.existsSync(checkpointPath)) {
    const raw = fs.readFileSync(checkpointPath, 'utf-8');
    checkpoint = parseCheckpointFrontmatter(raw);
    checkpointBody = raw;
  }

  return { config, queue, ledger, checkpoint, checkpointBody };
}
