const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('Bond transfer policy integration primitive', function () {
  async function fixture() {
    const [admin, alice, bob, outsider] = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory('TestIdentityRegistry')).deploy();
    const policy = await (await ethers.getContractFactory('QIBTransferPolicy')).deploy(admin.address, await registry.getAddress());
    const hook = await (await ethers.getContractFactory('TestBondHook')).deploy(await policy.getAddress());
    const expires = (await time.latest()) + 86400;
    for (const wallet of [alice, bob]) {
      await registry.setVerified(wallet.address, true);
      await policy.setQIB(wallet.address, expires, ethers.id('off-chain evidence reference'));
    }
    return { admin, alice, bob, outsider, registry, policy, hook, expires };
  }
  it('permits verified, current QIBs and issuance/redemption endpoints', async function () {
    const { alice, bob, hook } = await loadFixture(fixture);
    await hook.check(alice.address, bob.address, 1, 100);
    await hook.check(ethers.ZeroAddress, alice.address, 1, 100);
    await hook.check(alice.address, ethers.ZeroAddress, 1, 100);
    await expect(hook.check(ethers.ZeroAddress, ethers.ZeroAddress, 1, 100)).to.be.revertedWithCustomError(hook, 'TransferNotPermitted');
  });
  it('checks both owners even for zero-value transfers', async function () {
    const { alice, outsider, hook } = await loadFixture(fixture);
    for (const [from, to] of [[alice, outsider], [outsider, alice]]) {
      await expect(hook.check(from.address, to.address, 1, 0)).to.be.revertedWithCustomError(hook, 'TransferNotPermitted');
    }
  });
  it('rejects expired approvals at the exact expiry boundary', async function () {
    const { alice, bob, hook, expires } = await loadFixture(fixture);
    await time.increaseTo(expires);
    await expect(hook.check(alice.address, bob.address, 1, 1)).to.be.revertedWithCustomError(hook, 'TransferNotPermitted');
  });
  it('honors identity revocation, freeze, QIB revocation and pause', async function () {
    const { alice, bob, hook, registry, policy } = await loadFixture(fixture);
    const denied = () => expect(hook.check(alice.address, bob.address, 1, 1)).to.be.revertedWithCustomError(hook, 'TransferNotPermitted');
    await registry.setVerified(alice.address, false); await denied();
    await registry.setVerified(alice.address, true);
    await policy.setFrozen(bob.address, true); await denied();
    await policy.setFrozen(bob.address, false);
    await policy.setPaused(true); await denied();
    await policy.setPaused(false);
    await policy.setQIB(alice.address, 0, ethers.ZeroHash); await denied();
  });
  it('restricts policy administration and rejects unsupported approval evidence', async function () {
    const { outsider, alice, policy, expires } = await loadFixture(fixture);
    await expect(policy.connect(outsider).setQIB(alice.address, expires, ethers.id('x'))).to.be.revertedWithCustomError(policy, 'OwnableUnauthorizedAccount');
    await expect(policy.connect(outsider).setFrozen(alice.address, true)).to.be.reverted;
    await expect(policy.connect(outsider).setPaused(true)).to.be.reverted;
    await expect(policy.setQIB(alice.address, expires, ethers.ZeroHash)).to.be.revertedWith('Invalid approval');
  });
});
