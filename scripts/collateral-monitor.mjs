import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Contract, JsonRpcProvider, isAddress } from 'ethers';

const DAY = 86400;
const thresholds = [120, 90, 60, 30];
function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}
function amount(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Amounts must be unsigned integer strings');
  return BigInt(value);
}

// All balances must already be eligible collateral in the same currency/unit as required.
// This function does not determine statutory credit, haircuts or FX rates.
export function evaluate(snapshot, previous = { version: 1, alerts: {} }, now = Math.floor(Date.now() / 1000)) {
  integer(now, 'now');
  if (previous.version !== 1 || !previous.alerts || Array.isArray(previous.alerts)) throw new Error('Invalid state');
  integer(snapshot.observedAt, 'observedAt');
  if (snapshot.observedAt > now || now - snapshot.observedAt > 3600) throw new Error('Stale or future snapshot');
  if (!Array.isArray(snapshot.locs) || !snapshot.locs.length) throw new Error('Invalid or empty LOC list');
  const state = structuredClone(previous);
  const added = [];
  const ids = new Set();
  const add = (key, event) => {
    if (!Object.hasOwn(state.alerts, key)) {
      state.alerts[key] = { ...event, createdAt: now, status: 'pending' };
      added.push({ key, ...state.alerts[key] });
    }
  };
  for (const loc of snapshot.locs) {
    if (typeof loc.id !== 'string' || !loc.id || ids.has(loc.id)) throw new Error('Missing or duplicate LOC id');
    ids.add(loc.id);
    integer(loc.expiry, 'expiry'); integer(loc.revision, 'revision');
    integer(loc.observedAt, 'LOC observedAt');
    if (loc.observedAt > snapshot.observedAt || now - loc.observedAt > 86400) throw new Error('Stale or future LOC valuation');
    if (typeof loc.currency !== 'string' || !/^[A-Z]{3}$/.test(loc.currency)) throw new Error('Invalid currency');
    const balance = amount(loc.eligibleBalance);
    const required = amount(loc.requiredBalance);
    const prefix = JSON.stringify([loc.id, loc.expiry]);
    const base = { locId: loc.id, revision: loc.revision, expiry: loc.expiry, currency: loc.currency };
    const secondsLeft = loc.expiry - now;
    if (secondsLeft <= 0) {
      add(`${prefix}:expired`, { ...base, type: 'expired' });
    } else {
      // Catch up all crossed milestones on first run or after downtime.
      for (const days of thresholds) if (secondsLeft <= days * DAY) {
        add(`${prefix}:expiry:${days}`, { ...base, type: 'expiry', thresholdDays: days });
      }
    }
    // An expired LOC contributes zero even if a registry still reports a balance.
    const usable = secondsLeft <= 0 ? 0n : balance;
    if (usable < required) {
      add(`${prefix}:deficiency:${Math.floor(now / DAY)}`, {
        ...base, type: 'deficiency', shortfall: (required - usable).toString(),
        eligibleBalance: usable.toString(), requiredBalance: required.toString(),
      });
    }
  }
  state.lastSuccessfulRun = now;
  return { state, added };
}

// Reads the ProofStream CollateralRegistry at a common finalized block.
export async function readRegistry(config, provider) {
  if (!isAddress(config.registry) || !Array.isArray(config.locIds) || !config.locIds.length) throw new Error('Invalid registry config');
  if (new Set(config.locIds).size !== config.locIds.length) throw new Error('Duplicate LOC ids');
  if (config.locIds.some(id => typeof id !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(id))) throw new Error('Invalid bytes32 LOC id');
  integer(config.chainId, 'chainId');
  if ((await provider.getNetwork()).chainId !== BigInt(config.chainId)) throw new Error('Wrong chain');
  const block = await provider.getBlock('finalized');
  if (!block) throw new Error('Finalized block unavailable');
  const registry = new Contract(config.registry, [
    'function getLOC(bytes32 id) view returns (uint64 expiry,uint64 revision,uint256 eligibleBalance,uint256 requiredBalance,string currency,uint64 observedAt)',
  ], provider);
  const locs = [];
  for (const id of config.locIds) {
    const result = await registry.getLOC(id, { blockTag: block.number });
    locs.push({ id, expiry: Number(result.expiry), revision: Number(result.revision),
      eligibleBalance: result.eligibleBalance.toString(), requiredBalance: result.requiredBalance.toString(), currency: result.currency, observedAt: Number(result.observedAt) });
  }
  // Reject a canonical-block change while reading. Finality is never silently downgraded.
  if ((await provider.getBlock(block.number))?.hash !== block.hash) throw new Error('Block changed during read');
  return { observedAt: block.timestamp, blockNumber: block.number, blockHash: block.hash, locs };
}

export async function main(args) {
  const [mode, sourcePath, statePath] = args;
  if (!['--snapshot', '--rpc'].includes(mode) || !sourcePath || !statePath) throw new Error('Usage: node scripts/collateral-monitor.mjs --snapshot|--rpc INPUT.json STATE.json');
  const lock = `${statePath}.lock`;
  await mkdir(lock); // Exclusive single-host lock. Remove manually only after a crashed process is confirmed dead.
  let provider;
  try {
    const source = JSON.parse(await readFile(sourcePath, 'utf8'));
    let snapshot = source;
    if (mode === '--rpc') {
      if (!process.env.SEPOLIA_RPC_URL) throw new Error('SEPOLIA_RPC_URL is required');
      provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
      snapshot = await readRegistry(source, provider);
    }
    let previous;
    try { previous = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const { state, added } = evaluate(snapshot, previous);
    // Persist an outbox BEFORE exposing new events. Pending alerts remain recoverable
    // across a crash; delivery/acknowledgment is deliberately a separate integration.
    const temporary = `${statePath}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, statePath);
    console.log(JSON.stringify({ added, pending: Object.keys(state.alerts).filter(k => state.alerts[k].status === 'pending').length }));
  } finally {
    provider?.destroy();
    await rm(lock, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    // RPC errors can contain credential-bearing URLs. Do not log the raw error.
    console.error('Collateral monitor failed; no successful run recorded. Check input, freshness, lock and RPC configuration.');
    process.exitCode = 1;
  });
}
