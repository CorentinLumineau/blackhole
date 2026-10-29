import * as fs from 'fs';
import * as path from 'path';

// Host-resource gate the orchestrator runs before spawning a batch of test/build-bearing
// workers (orchestrator-runtime.md § Background worker barrier). Linux /proc only: on any host
// without it the verdict is `unavailable`, which fails open with the requested batch but always
// carries a reason, so a missing measurement never reads as a healthy one.

export type HostSample = { memAvailableMb: number; load1: number; nproc: number; dState: number };

export type ResourceGateThresholds = {
  deferBelowMemMb: number;
  fullAboveMemMb: number;
  deferAboveLoadRatio: number;
  fullBelowLoadRatio: number;
  deferAboveDState: number;
};

export type ResourceGateVerdict = {
  verdict: 'go' | 'degrade' | 'defer' | 'unavailable';
  batch_size: number;
  reasons: string[];
};

export const DEFAULT_RESOURCE_GATE: ResourceGateThresholds = {
  deferBelowMemMb: 2500,
  fullAboveMemMb: 3500,
  deferAboveLoadRatio: 2.0,
  fullBelowLoadRatio: 1.0,
  deferAboveDState: 10,
};

const CONFIG_KEYS: Record<keyof ResourceGateThresholds, string> = {
  deferBelowMemMb: 'defer_below_mem_mb',
  fullAboveMemMb: 'full_above_mem_mb',
  deferAboveLoadRatio: 'defer_above_load_ratio',
  fullBelowLoadRatio: 'full_below_load_ratio',
  deferAboveDState: 'defer_above_dstate',
};

export const parseMemAvailableMb = (meminfo: string): number | null => {
  const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  return match ? Math.round(Number(match[1]) / 1024) : null;
};

export const parseLoad1 = (loadavg: string): number | null => {
  const value = Number.parseFloat(loadavg.trim().split(/\s+/)[0] ?? '');
  return Number.isFinite(value) ? value : null;
};

// The process name in /proc/<pid>/stat is parenthesised and may itself contain ')', so the
// state field is read after the LAST ')'.
export const countDState = (statContents: string[]): number =>
  statContents.filter((stat) => stat.slice(stat.lastIndexOf(')') + 1).trim().startsWith('D')).length;

export const readHostSample = (procRoot: string, nproc: number): HostSample | null => {
  const read = (file: string): string | null => {
    try {
      return fs.readFileSync(path.join(procRoot, file), 'utf-8');
    } catch {
      return null;
    }
  };
  const meminfo = read('meminfo');
  const loadavg = read('loadavg');
  const memAvailableMb = meminfo === null ? null : parseMemAvailableMb(meminfo);
  const load1 = loadavg === null ? null : parseLoad1(loadavg);
  if (memAvailableMb === null || load1 === null || !Number.isInteger(nproc) || nproc < 1) return null;
  let pids: string[];
  try {
    pids = fs.readdirSync(procRoot).filter((entry) => /^\d+$/.test(entry));
  } catch {
    return null;
  }
  // A pid that exits mid-scan, or one hidden by a `hidepid` mount, has no readable stat and is
  // skipped, so D-state can undercount on such hosts; MemAvailable and load still gate.
  const stats = pids.map((pid) => read(path.join(pid, 'stat'))).filter((stat): stat is string => stat !== null);
  return { memAvailableMb, load1, nproc, dState: countDState(stats) };
};

export const resolveResourceGateThresholds = (config: Record<string, unknown>): ResourceGateThresholds => {
  const policy = (config.resource_policy ?? {}) as Record<string, unknown>;
  const gate = (policy.gate ?? {}) as Record<string, unknown>;
  const thresholds = { ...DEFAULT_RESOURCE_GATE };
  for (const [field, key] of Object.entries(CONFIG_KEYS) as [keyof ResourceGateThresholds, string][]) {
    if (gate[key] === undefined) continue;
    if (typeof gate[key] !== 'number') throw new Error(`resource_policy.gate.${key} must be a number`);
    thresholds[field] = gate[key] as number;
  }
  return thresholds;
};

export const evaluateResourceGate = (
  sample: HostSample | null,
  requested: number,
  t: ResourceGateThresholds,
): ResourceGateVerdict => {
  if (sample === null) {
    return {
      verdict: 'unavailable',
      batch_size: requested,
      reasons: ['host metrics unavailable (no readable /proc meminfo/loadavg, or no core count) — gate not applied'],
    };
  }
  const ratio = sample.load1 / sample.nproc;
  const mem = `MemAvailable ${sample.memAvailableMb}MB`;
  const load = `load1/nproc ${ratio.toFixed(2)}`;
  const defer: string[] = [];
  const degrade: string[] = [];
  if (sample.memAvailableMb < t.deferBelowMemMb) defer.push(`${mem} < ${t.deferBelowMemMb}MB`);
  else if (sample.memAvailableMb < t.fullAboveMemMb) degrade.push(`${mem} < ${t.fullAboveMemMb}MB`);
  if (ratio > t.deferAboveLoadRatio) defer.push(`${load} > ${t.deferAboveLoadRatio}`);
  else if (ratio > t.fullBelowLoadRatio) degrade.push(`${load} > ${t.fullBelowLoadRatio}`);
  if (sample.dState > t.deferAboveDState) defer.push(`D-state ${sample.dState} > ${t.deferAboveDState}`);
  if (defer.length) return { verdict: 'defer', batch_size: 0, reasons: [...defer, ...degrade] };
  if (degrade.length) return { verdict: 'degrade', batch_size: Math.min(1, requested), reasons: degrade };
  return { verdict: 'go', batch_size: requested, reasons: [] };
};
