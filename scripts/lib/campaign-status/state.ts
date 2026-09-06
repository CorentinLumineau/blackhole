import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import { parseCheckpointFrontmatter } from './checkpoint.ts';
import type { LedgerJson, QueueJson } from './types.ts';

// Thrown when `campaignDir` itself doesn't exist — the fresh-checkout/wrong-directory case,
// distinct from a campaign directory that exists but holds unparseable JSON (which still
// propagates `readJsonFile`'s generic Error uncaught, per issue #928 AC 2). Callers that want
// to render this case as a clean message instead of a crash check `instanceof
// CampaignNotFoundError`.
export class CampaignNotFoundError extends Error {
  constructor(campaignDir: string) {
    super(`No campaign found at ${campaignDir} (no .blackhole/ directory here — nothing to show).`);
    this.name = 'CampaignNotFoundError';
  }
}

export function loadCampaignState(campaignDir: string) {
  // Guard-before-load (reuses the shape of doctor.ts's checkConfigExists, not its DoctorCheck
  // return type — V-INT-02): one existence check ahead of all three JSON reads below, since an
  // absent directory would otherwise fail identically on whichever file readJsonFile hits
  // first. readJsonFile itself stays unchanged — it has 16 other call sites depending on its
  // current throw-with-label behavior, and preserves no error.code/cause a catch here could use
  // to distinguish "absent" from "corrupt" without this upfront check.
  if (!fs.existsSync(campaignDir)) {
    throw new CampaignNotFoundError(campaignDir);
  }

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
