const { expect } = require('chai');
const { ethers, artifacts } = require('hardhat');
describe('Bond deployment preparation', function () {
  it('deploys the suite locally with explicit roles and checkpointed evidence', async function () {
    const { contractNames, deployBondSuite } = await import('../scripts/bond-deployment.mjs');
    const [deployer, governance, compliance, issuer, trustee] = await ethers.getSigners();
    const bundle = {};
    for (const name of contractNames) bundle[name] = await artifacts.readArtifact(name);
    const records = [];
    const roles = { governance: governance.address, compliance: compliance.address, issuer: issuer.address, trustee: trustee.address };
    const addresses = await deployBondSuite(deployer, bundle, roles, 31337, async record => records.push(record));
    expect(records.length).to.equal(8);
    const bond = await ethers.getContractAt('ProofStreamBond', addresses.ProofStreamBond);
    expect(await bond.governance()).to.equal(governance.address);
    expect(await bond.issuers(issuer.address)).to.equal(true);
    expect(await bond.trustees(trustee.address)).to.equal(true);
    const identity = await ethers.getContractAt('InstitutionalIdentityRegistry', addresses.InstitutionalIdentityRegistry);
    expect(await identity.owner()).to.equal(compliance.address);
    await expect(deployBondSuite(deployer, bundle, roles, 1, async () => {})).to.be.rejectedWith('Only local');
    await expect(deployBondSuite(deployer, bundle, roles, 11155111, async () => {})).to.be.rejectedWith('Wallet chain changed');
  });
});
