const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const h = ethers.id;
const valueTransfer = 'transferFrom(uint256,uint256,uint256)';
const split = 'transferFrom(uint256,address,uint256)';
const certificate = 'transferFrom(address,address,uint256)';
async function fixture() {
  const [admin, issuer, trustee, alice, bob, outsider] = await ethers.getSigners();
  const identity = await (await ethers.getContractFactory('InstitutionalIdentityRegistry')).deploy(admin.address);
  const policy = await (await ethers.getContractFactory('QIBTransferPolicy')).deploy(admin.address, identity.target);
  const bond = await (await ethers.getContractFactory('ProofStreamBond')).deploy(admin.address, issuer.address, trustee.address, policy.target);
  const expiry = (await time.latest()) + 86400;
  for (const wallet of [alice, bob]) {
    await identity.setIdentity(wallet.address, expiry, h('identity'));
    await policy.setQIB(wallet.address, expiry, h('qib'));
  }
  await bond.connect(issuer).createSeries(1, h('terms'), '0x455552', expiry, 10000);
  await bond.connect(issuer).createSeries(2, h('other'), '0x455552', expiry, 10000);
  await bond.connect(issuer).issue(alice.address, 1, 1000, h('issue1'));
  await bond.connect(issuer).issue(bob.address, 1, 500, h('issue2'));
  return { admin, issuer, trustee, alice, bob, outsider, identity, policy, bond, expiry };
}
describe('Concrete ERC-3525 institutional bond', function () {
  it('supports ERC-3525, splits and merges without changing outstanding face value', async function () {
    const { alice, bob, bond } = await loadFixture(fixture);
    expect(await bond.supportsInterface('0xd5358140')).to.equal(true);
    await bond.connect(alice)[split](1, bob.address, 250);
    expect(await bond.ownerOf(3)).to.equal(bob.address);
    expect(await bond['balanceOf(uint256)'](1)).to.equal(750);
    await bond.connect(bob)[valueTransfer](3, 2, 250);
    expect(await bond['balanceOf(uint256)'](2)).to.equal(750);
    expect((await bond.series(1)).outstanding).to.equal(1500);
  });
  it('checks eligibility on every certificate transfer overload', async function () {
    const { alice, bob, bond, policy } = await loadFixture(fixture);
    await policy.setFrozen(bob.address, true);
    for (const signature of [certificate, 'safeTransferFrom(address,address,uint256)', 'safeTransferFrom(address,address,uint256,bytes)']) {
      const args = [alice.address, bob.address, 1]; if (signature.endsWith(',bytes)')) args.push('0x');
      await expect(bond.connect(alice)[signature](...args)).to.be.revertedWithCustomError(bond, 'TransferNotPermitted');
    }
    await policy.setFrozen(bob.address, false);
    await bond.connect(alice)['safeTransferFrom(address,address,uint256)'](alice.address, bob.address, 1);
    expect(await bond.ownerOf(1)).to.equal(bob.address);
  });
  it('checks both value-transfer endpoints, including operators and zero values', async function () {
    const { alice, bob, outsider, bond, policy } = await loadFixture(fixture);
    await bond.connect(alice)['approve(uint256,address,uint256)'](1, outsider.address, 100);
    await policy.setFrozen(alice.address, true);
    await expect(bond.connect(outsider)[valueTransfer](1, 2, 100)).to.be.revertedWithCustomError(bond, 'TransferNotPermitted');
    await expect(bond.connect(alice)[split](1, bob.address, 0)).to.be.revertedWithCustomError(bond, 'TransferNotPermitted');
    expect(await bond.totalSupply()).to.equal(2);
    await policy.setFrozen(alice.address, false);
    await bond.connect(outsider)[valueTransfer](1, 2, 100);
    expect(await bond.allowance(1, outsider.address)).to.equal(0);
    await expect(bond.connect(outsider)[valueTransfer](1, 2, 1)).to.be.reverted;
  });
  it('enforces identity expiry, slot separation, issuance limits and authorization', async function () {
    const { alice, bob, outsider, issuer, identity, bond } = await loadFixture(fixture);
    await expect(bond.connect(outsider).issue(alice.address, 1, 1, h('unauthorized'))).to.be.revertedWith('Not issuer');
    await expect(bond.connect(issuer).issue(alice.address, 1, 9000, h('cap'))).to.be.revertedWith('Issuance cap');
    await bond.connect(issuer).issue(bob.address, 2, 10, h('different-slot'));
    await expect(bond.connect(alice)[valueTransfer](1, 3, 1)).to.be.revertedWith('ERC3525: transfer to token with different slot');
    await identity.setIdentity(alice.address, 0, ethers.ZeroHash);
    await expect(bond.connect(alice)[valueTransfer](1, 2, 1)).to.be.revertedWithCustomError(bond, 'TransferNotPermitted');
  });
  it('records partial/full redemption without reopening the issuance cap', async function () {
    const { trustee, bond } = await loadFixture(fixture);
    await bond.connect(trustee).recordRedemption(1, 400, h('paid1'));
    expect(await bond['balanceOf(uint256)'](1)).to.equal(600);
    await expect(bond.connect(trustee).recordRedemption(1, 1, h('paid1'))).to.be.revertedWith('Invalid reference');
    await bond.connect(trustee).recordRedemption(1, 600, h('paid2'));
    await expect(bond.ownerOf(1)).to.be.reverted;
    const s = await bond.series(1); expect(s.outstanding).to.equal(500); expect(s.issued).to.equal(1500);
  });
  it('recovers frozen source, clears approvals, preserves face value and gates destination', async function () {
    const { alice, bob, outsider, trustee, bond, policy } = await loadFixture(fixture);
    await bond.connect(alice)['approve(uint256,address,uint256)'](1, outsider.address, 100);
    await bond.connect(alice)['approve(address,uint256)'](outsider.address, 1);
    await policy.setFrozen(alice.address, true);
    await expect(bond.connect(outsider).recover(1, bob.address, h('order'))).to.be.revertedWith('Not trustee');
    await expect(bond.connect(trustee).recover(1, outsider.address, h('order'))).to.be.revertedWith('Recovery not permitted');
    await policy.setPaused(true);
    await expect(bond.connect(trustee).recover(1, bob.address, h('order'))).to.be.revertedWith('Recovery not permitted');
    await policy.setPaused(false);
    await bond.connect(trustee).recover(1, bob.address, h('order'));
    expect(await bond.ownerOf(1)).to.equal(bob.address);
    expect(await bond.getApproved(1)).to.equal(ethers.ZeroAddress);
    expect(await bond.allowance(1, outsider.address)).to.equal(0);
    expect((await bond.series(1)).outstanding).to.equal(1500);
    await expect(bond.connect(outsider)[certificate](bob.address, outsider.address, 1)).to.be.reverted;
  });
  it('rotates issuer/trustee roles only through governance', async function () {
    const { admin, issuer, trustee, outsider, alice, bond } = await loadFixture(fixture);
    await expect(bond.connect(outsider).setRoles(outsider.address, true, true)).to.be.revertedWith('Not governance');
    await expect(bond.connect(admin).setRoles(ethers.ZeroAddress, true, true)).to.be.revertedWith('Zero role');
    await bond.connect(admin).setRoles(issuer.address, false, false);
    await expect(bond.connect(issuer).issue(alice.address, 1, 1, h('revoked'))).to.be.revertedWith('Not issuer');
    await bond.connect(admin).setRoles(trustee.address, false, false);
    await expect(bond.connect(trustee).recordRedemption(1, 1, h('revoked-burn'))).to.be.revertedWith('Not trustee');
    await bond.connect(admin).setRoles(outsider.address, true, true);
    await bond.connect(outsider).issue(alice.address, 1, 1, h('replacement'));
  });
  it('rejects invalid terms, reused references and issuance after maturity', async function () {
    const { issuer, alice, bond, expiry } = await loadFixture(fixture);
    await expect(bond.connect(issuer).createSeries(1, h('terms'), '0x455552', expiry, 1)).to.be.revertedWith('Invalid slot');
    await expect(bond.connect(issuer).createSeries(3, h('terms'), '0x657572', expiry, 1)).to.be.revertedWith('Invalid currency');
    await expect(bond.connect(issuer).issue(alice.address, 1, 1, h('issue1'))).to.be.revertedWith('Invalid reference');
    await time.increaseTo(expiry);
    await expect(bond.connect(issuer).issue(alice.address, 1, 1, h('late'))).to.be.revertedWith('Invalid issuance');
  });
  it('blocks callback reentry and rolls back rejected receiver transfers', async function () {
    const { alice, issuer, bond, identity, policy, expiry } = await loadFixture(fixture);
    const receiver = await (await ethers.getContractFactory('BondReceiver')).deploy();
    await identity.setIdentity(receiver.target, expiry, h('contract identity'));
    await policy.setQIB(receiver.target, expiry, h('contract qib'));
    await bond.connect(issuer).issue(receiver.target, 1, 10, h('receiver issue'));
    await receiver.configure(bond.target, 2, false);
    await bond.connect(alice)[valueTransfer](1, 3, 100);
    expect(await receiver.reentrySucceeded()).to.equal(false);
    expect(await bond['balanceOf(uint256)'](3)).to.equal(110);
    await receiver.configure(bond.target, 2, true);
    await expect(bond.connect(alice)[valueTransfer](1, 3, 100)).to.be.revertedWith('ERC3525: transfer rejected by ERC3525Receiver');
    expect(await bond['balanceOf(uint256)'](1)).to.equal(900);
    await expect(bond.connect(alice)['safeTransferFrom(address,address,uint256)'](alice.address, receiver.target, 1)).to.be.reverted;
    expect(await bond.ownerOf(1)).to.equal(alice.address);
  });
  it('bounds approval cleanup and blocks zero-value stranger allowance griefing', async function () {
    const { alice, bob, outsider, trustee, bond } = await loadFixture(fixture);
    await expect(bond.connect(outsider)[valueTransfer](1, 2, 0)).to.be.revertedWith('Not authorized');
    for (let i = 1; i <= 64; i++) {
      await bond.connect(alice)['approve(uint256,address,uint256)'](1, ethers.getAddress(ethers.toBeHex(i, 20)), 1);
    }
    await expect(bond.connect(alice)['approve(uint256,address,uint256)'](1, outsider.address, 1)).to.be.revertedWith('Too many value approvals');
    await bond.connect(trustee).recover(1, bob.address, h('bounded recovery'));
    expect(await bond.valueApprovalCount(1)).to.equal(0);
  });
  it('blocks issuance/redemption while paused and rejects ETH', async function () {
    const { issuer, trustee, alice, bob, policy, bond } = await loadFixture(fixture);
    await policy.setPaused(true);
    await expect(bond.connect(issuer).issue(alice.address, 1, 1, h('paused'))).to.be.revertedWithCustomError(bond, 'TransferNotPermitted');
    await expect(bond.connect(trustee).recordRedemption(1, 1, h('paused-burn'))).to.be.revertedWithCustomError(bond, 'TransferNotPermitted');
    await policy.setPaused(false);
    await expect(bond.connect(alice)[split](1, bob.address, 1, { value: 1 })).to.be.revertedWith('No ETH');
  });
});
module.exports = { fixture };
