import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { AGENT_PLUGINS_DISTRIBUTION_ROOT } from '../lib/build/paths.ts';
import { agentPluginsTreeErrors } from '../tree-shape.ts';
import { runFullBuildOnce } from '../lib/check-common.ts';

// issue #484 — agent-plugins-build.check.ts: agent-plugins.org distribution bundle shape.

export const evaluateAgentPluginsBundle = (destRoot: string): string[] =>
  agentPluginsTreeErrors(destRoot, path.join(destRoot, 'plugin.json'));

const checkAgentPluginsDistributionBundle = (): CheckResult => {
  if (process.env.VERIFY_SKIP_BUILD !== '1') {
    const build = runFullBuildOnce();
    if (!build.ok) {
      return { id: 'V-AGENTPLUGINS-01', ok: false, detail: `build failed: ${build.output}` };
    }
  }

  const bundleRoot = path.join(root, AGENT_PLUGINS_DISTRIBUTION_ROOT);
  if (!fs.existsSync(bundleRoot)) {
    return {
      id: 'V-AGENTPLUGINS-01',
      ok: false,
      detail: `${AGENT_PLUGINS_DISTRIBUTION_ROOT} missing — git-track the bundle to enable Target F builds`,
    };
  }

  const errors = evaluateAgentPluginsBundle(bundleRoot);
  if (errors.length) return { id: 'V-AGENTPLUGINS-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-AGENTPLUGINS-01', ok: true };
};

export const runChecks = (): CheckResult[] => [checkAgentPluginsDistributionBundle()];
