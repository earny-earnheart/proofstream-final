const assert = require('node:assert/strict');

describe('Collateral monitor', function () {
  const now = 1800000000;
  let evaluate;
  before(async () => { ({ evaluate } = await import('../scripts/collateral-monitor.mjs')); });
  function snapshot(days = 100, balance = '100', required = '100') {
    return { observedAt: now, locs: [{ id: 'LOC-1', revision: 1, observedAt: now, expiry: now + days * 86400,
      currency: 'EUR', eligibleBalance: balance, requiredBalance: required }] };
  }
  it('catches up thresholds and deduplicates repeat runs', function () {
    const input = snapshot(30);
    const first = evaluate(input, undefined, now);
    assert.deepEqual(first.added.map(x => x.thresholdDays), [120, 90, 60, 30]);
    assert.equal(evaluate(input, first.state, now).added.length, 0);
  });
  it('does not resend milestones on valuation revisions and rejects old LOC observations', function () {
    const input = snapshot(30);
    const first = evaluate(input, undefined, now);
    input.locs[0].revision++;
    assert.equal(evaluate(input, first.state, now).added.length, 0);
    input.locs[0].observedAt = now - 86401;
    assert.throws(() => evaluate(input, first.state, now));
  });
  it('handles boundaries, expiration and renewal', function () {
    assert.equal(evaluate(snapshot(121), undefined, now).added.length, 0);
    assert.equal(evaluate(snapshot(120), undefined, now).added.length, 1);
    const first = evaluate(snapshot(0), undefined, now);
    assert.deepEqual(first.added.map(x => x.type), ['expired', 'deficiency']);
    assert.equal(first.added[1].shortfall, '100');
    const renewed = snapshot(120); renewed.locs[0].revision = 2;
    assert.equal(evaluate(renewed, first.state, now).added.length, 1);
  });
  it('uses exact large integers and emits daily deficiency alerts', function () {
    const input = snapshot(200, '9007199254740993000', '9007199254740993001');
    const first = evaluate(input, undefined, now);
    assert.equal(first.added[0].shortfall, '1');
    input.observedAt += 86400;
    input.locs[0].observedAt += 86400;
    assert.equal(evaluate(input, first.state, now + 86400).added.length, 1);
  });
  it('rejects stale/future data, invalid values, duplicates and corrupt state', function () {
    for (const observedAt of [now - 3601, now + 1]) {
      assert.throws(() => evaluate({ ...snapshot(), observedAt }, undefined, now));
    }
    assert.throws(() => evaluate(snapshot(100, '-1'), undefined, now));
    assert.throws(() => evaluate(snapshot(100, 100), undefined, now));
    const duplicate = snapshot(); duplicate.locs.push(duplicate.locs[0]);
    assert.throws(() => evaluate(duplicate, undefined, now));
    assert.throws(() => evaluate(snapshot(), {}, now));
    assert.throws(() => evaluate({ observedAt: now, locs: [] }, undefined, now));
  });
  it('persists pending alerts across CLI restarts and preserves state on failure', async function () {
    const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const { promisify } = require('node:util');
    const execFile = promisify(require('node:child_process').execFile);
    const directory = await mkdtemp(join(tmpdir(), 'proofstream-monitor-'));
    try {
      const source = join(directory, 'snapshot.json');
      const state = join(directory, 'state.json');
      const current = Math.floor(Date.now() / 1000);
      const input = snapshot(30); input.observedAt = current; input.locs[0].observedAt = current; input.locs[0].expiry = current + 30 * 86400;
      await writeFile(source, JSON.stringify(input));
      const args = ['scripts/collateral-monitor.mjs', '--snapshot', source, state];
      const first = JSON.parse((await execFile(process.execPath, args)).stdout);
      assert.equal(first.added.length, 4);
      const second = JSON.parse((await execFile(process.execPath, args)).stdout);
      assert.equal(second.added.length, 0); assert.equal(second.pending, 4);
      const before = await readFile(state, 'utf8');
      input.observedAt = 1; await writeFile(source, JSON.stringify(input));
      await assert.rejects(execFile(process.execPath, args));
      assert.equal(await readFile(state, 'utf8'), before);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
