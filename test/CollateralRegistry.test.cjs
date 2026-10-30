const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('Signed collateral registry', function () {
  let types, domain;
  before(async () => { ({ collateralTypes: types, collateralDomain: domain } = await import('../scripts/collateral-signing.mjs')); });
  async function fixture() {
    const [admin, attestor, relay, outsider] = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory('CollateralRegistry')).deploy(admin.address);
    await registry.setAttestor(attestor.address, true);
    const now = await time.latest();
    const a = { id: ethers.id('LOC-1'), expiry: now + 30 * 86400, revision: 1,
      eligibleBalance: 900, requiredBalance: 1000, currency: '0x455552',
      documentHash: ethers.id('document bytes'), locatorHash: ethers.id('ipfs://example'),
      observedAt: now, deadline: now + 3600, nonce: 0 };
    const d = domain(31337, registry.target);
    const sign = (record = a, signer = attestor, signingDomain = d) => signer.signTypedData(signingDomain, types, record);
    return { admin, attestor, relay, outsider, registry, a, d, sign };
  }
  it('accepts relayed EIP-712 signatures and matches the JS digest', async function () {
    const { registry, attestor, relay, a, d, sign } = await loadFixture(fixture);
    expect(await registry.digest(a)).to.equal(ethers.TypedDataEncoder.hash(d, types, a));
    await registry.connect(relay).submit(a, attestor.address, await sign());
    const record = await registry.getLOC(a.id);
    expect(record.currency).to.equal('EUR'); expect(record.observedAt).to.equal(a.observedAt);
    expect(record.eligibleBalance).to.equal(900);
    expect(await registry.nonces(attestor.address)).to.equal(1);
    await expect(registry.submit(a, attestor.address, await sign())).to.be.reverted;
  });
  it('rejects wrong chain/contract domains, tampering and unapproved signers', async function () {
    const { registry, attestor, outsider, a, d, sign } = await loadFixture(fixture);
    for (const badDomain of [{ ...d, chainId: 1 }, { ...d, verifyingContract: outsider.address }]) {
      await expect(registry.submit(a, attestor.address, await sign(a, attestor, badDomain))).to.be.revertedWith('Invalid signature');
    }
    await expect(registry.submit({ ...a, eligibleBalance: 999 }, attestor.address, await sign())).to.be.revertedWith('Invalid signature');
    await expect(registry.submit(a, outsider.address, await sign(a, outsider))).to.be.revertedWith('Unauthorized attestor');
  });
  it('enforces revision ordering, nonces, revocation and deadlines', async function () {
    const { registry, attestor, a, sign } = await loadFixture(fixture);
    await expect(registry.submit({ ...a, nonce: 1 }, attestor.address, await sign({ ...a, nonce: 1 }))).to.be.revertedWith('Invalid nonce');
    await registry.submit(a, attestor.address, await sign());
    const next = { ...a, revision: 2, nonce: 1 };
    await registry.setAttestor(attestor.address, false);
    await expect(registry.submit(next, attestor.address, await sign(next))).to.be.revertedWith('Unauthorized attestor');
    await registry.setAttestor(attestor.address, true);
    await time.increaseTo(a.deadline + 1);
    const fresh = { ...next, observedAt: a.deadline + 1 };
    await expect(registry.submit(fresh, attestor.address, await sign(fresh))).to.be.revertedWith('Expired signature');
  });
  it('rejects stale observations, future observations, and unknown records', async function () {
    const { registry, attestor, a, sign } = await loadFixture(fixture);
    const stale = { ...a, observedAt: a.observedAt - 3601 };
    await expect(registry.submit(stale, attestor.address, await sign(stale))).to.be.revertedWith('Stale observation');
    const future = { ...a, observedAt: a.observedAt + 100 };
    await expect(registry.submit(future, attestor.address, await sign(future))).to.be.revertedWith('Stale observation');
    await expect(registry.getLOC(a.id)).to.be.revertedWith('Unknown LOC');
  });
  it('keeps currency immutable, updates revisions and exposes evidence commitments', async function () {
    const { registry, attestor, outsider, a, sign } = await loadFixture(fixture);
    await expect(registry.connect(outsider).setAttestor(outsider.address, true)).to.be.reverted;
    await expect(registry.setAttestor(ethers.ZeroAddress, true)).to.be.revertedWith('Zero signer');
    await registry.submit(a, attestor.address, await sign());
    const changed = { ...a, revision: 2, nonce: 1, currency: '0x555344' };
    await expect(registry.submit(changed, attestor.address, await sign(changed))).to.be.revertedWith('Currency changed');
    const next = { ...a, revision: 2, nonce: 1, eligibleBalance: 1200 };
    await registry.submit(next, attestor.address, await sign(next));
    expect((await registry.getLOC(a.id)).revision).to.equal(2);
    const evidence = await registry.getEvidence(a.id);
    expect(evidence.documentHash).to.equal(a.documentHash);
    expect(evidence.locatorHash).to.equal(a.locatorHash);
    await expect(registry.getEvidence(ethers.id('unknown'))).to.be.revertedWith('Unknown LOC');
  });
  it('supports authorized ERC-1271 contract signers', async function () {
    const { registry, a } = await loadFixture(fixture);
    const wallet = await (await ethers.getContractFactory('Test1271Attestor')).deploy();
    await registry.setAttestor(wallet.target, true);
    await wallet.setDigest(await registry.digest(a));
    await registry.submit(a, wallet.target, '0x');
    expect(await registry.nonces(wallet.target)).to.equal(1);
  });
  it('feeds the actual registry into finalized-block monitoring', async function () {
    const { registry, attestor, a, sign } = await loadFixture(fixture);
    await registry.submit(a, attestor.address, await sign());
    const block = await ethers.provider.getBlock('latest');
    const { readRegistry, evaluate } = await import('../scripts/collateral-monitor.mjs');
    // Local Hardhat does not model consensus finality. Map the tag only in this test.
    const provider = new Proxy(ethers.provider, { get(target, prop) {
      if (prop === 'getBlock') return tag => target.getBlock(tag === 'finalized' ? block.number : tag);
      const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
    } });
    const snapshot = await readRegistry({ chainId: 31337, registry: registry.target, locIds: [a.id] }, provider);
    const alerts = evaluate(snapshot, undefined, block.timestamp).added;
    expect(alerts.filter(x => x.type === 'expiry').length).to.equal(4);
    expect(alerts.find(x => x.type === 'deficiency').shortfall).to.equal('100');
    await expect(readRegistry({ chainId: 1, registry: registry.target, locIds: [a.id] }, provider)).to.be.rejectedWith('Wrong chain');
  });
});
