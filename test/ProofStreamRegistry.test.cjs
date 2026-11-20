const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ISRC = "USSKG2612345";
const REMIX = "USSKG2612346";
const b32 = (s) => ethers.encodeBytes32String(s);
const h = (s) => ethers.sha256(ethers.toUtf8Bytes(s));
const Status = { None: 0n, Active: 1n, Disputed: 2n, Frozen: 3n, Superseded: 4n, Revoked: 5n };

const split = (who, bps, rightType = "master", territory = "WW") => ({
  beneficiaryHash: h(who),
  basisPoints: bps,
  rightType: b32(rightType),
  territory: b32(territory),
});

describe("ProofStreamRegistry", () => {
  async function deploy() {
    const [admin, issuer, creator, buyer, reporter, stranger] = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory("ProofStreamRegistry")).deploy(admin.address);
    await registry.grantRole(await registry.ISSUER_ROLE(), issuer.address);
    await registry.grantRole(await registry.REPORTER_ROLE(), reporter.address);
    const asIssuer = registry.connect(issuer);
    const register = (isrc = ISRC, splits = [split("artist", 10000)], parent = "") =>
      asIssuer.registerRecording(isrc, creator.address, h("payload-v0"), h("claim-v0"), splits, parent);
    return { registry, asIssuer, register, admin, issuer, creator, buyer, reporter, stranger };
  }

  describe("registration", () => {
    it("registers and verifies a recording", async () => {
      const { registry, register, creator } = await loadFixture(deploy);
      await expect(register()).to.emit(registry, "RecordingRegistered");
      const v = await registry.verify(ISRC);
      expect(v.found).to.equal(true);
      expect(v.status).to.equal(Status.Active);
      expect(v.payloadHash).to.equal(h("payload-v0"));
      expect(v.claimant).to.equal(creator.address);
      expect(v.version).to.equal(0n);
    });

    it("returns found=false and status None for an unknown ISRC", async () => {
      const { registry } = await loadFixture(deploy);
      const v = await registry.verify(ISRC);
      expect(v.found).to.equal(false);
      expect(v.status).to.equal(Status.None);
    });

    it("rejects dashed, lower-case and malformed ISRCs", async () => {
      const { registry, asIssuer, creator } = await loadFixture(deploy);
      for (const bad of ["US-SKG-26-12345", "usskg2612345", "U1SKG2612345", "USSKG26A2345", "USSKG261234"]) {
        await expect(asIssuer.registerRecording(bad, creator.address, h("p"), h("c"), [], ""))
          .to.be.revertedWithCustomError(registry, "InvalidISRC");
      }
    });

    it("never registers the same ISRC twice", async () => {
      const { registry, register } = await loadFixture(deploy);
      await register();
      await expect(register()).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    });

    it("only the issuer can register", async () => {
      const { registry, creator } = await loadFixture(deploy);
      await expect(registry.connect(creator).registerRecording(ISRC, creator.address, h("p"), h("c"), [], ""))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("requires a claimant and both hashes", async () => {
      const { registry, asIssuer, creator } = await loadFixture(deploy);
      await expect(asIssuer.registerRecording(ISRC, ethers.ZeroAddress, h("p"), h("c"), [], ""))
        .to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(asIssuer.registerRecording(ISRC, creator.address, ethers.ZeroHash, h("c"), [], ""))
        .to.be.revertedWithCustomError(registry, "ZeroHash");
    });

    it("links a remix to its parent and rejects self-parenting", async () => {
      const { registry, register } = await loadFixture(deploy);
      await register();
      await register(REMIX, [], ISRC);
      expect((await registry.getRecording(REMIX)).parentIsrcHash).to.equal(await registry.isrcHashOf(ISRC));
      await expect(register("USSKG2612347", [], "USSKG2612347")).to.be.revertedWithCustomError(registry, "InvalidISRC");
    });
  });

  describe("splits", () => {
    it("accepts groups that each total 100% (master + publishing side by side)", async () => {
      const { registry, register } = await loadFixture(deploy);
      const splits = [
        split("label", 10000, "master"),
        split("writer-a", 5000, "publishing"),
        split("writer-b", 5000, "publishing"),
      ];
      await register(ISRC, splits);
      expect(await registry.splitsMatch(ISRC, 0, splits)).to.equal(true);
      expect(await registry.splitsMatch(ISRC, 0, [split("label", 10000, "master")])).to.equal(false);
    });

    it("rejects 9999 and 10001 basis points", async () => {
      const { registry, register } = await loadFixture(deploy);
      await expect(register(ISRC, [split("a", 4999), split("b", 5000)]))
        .to.be.revertedWithCustomError(registry, "SplitsDoNotSumToFull");
      await expect(register(ISRC, [split("a", 5001), split("b", 5000)]))
        .to.be.revertedWithCustomError(registry, "SplitsDoNotSumToFull");
    });

    it("rejects zero shares, missing codes and more than 32 entries", async () => {
      const { registry, register } = await loadFixture(deploy);
      await expect(register(ISRC, [split("a", 0), split("b", 10000)])).to.be.revertedWithCustomError(registry, "BadSplit");
      await expect(register(ISRC, [{ ...split("a", 10000), territory: ethers.ZeroHash }]))
        .to.be.revertedWithCustomError(registry, "BadSplit");
      const many = Array.from({ length: 33 }, (_, i) => split("w" + i, 1, "writer", "T" + i));
      await expect(register(ISRC, many)).to.be.revertedWithCustomError(registry, "TooManySplits");
    });
  });

  describe("claim history", () => {
    it("appends versions and never overwrites earlier ones", async () => {
      const { registry, register, creator } = await loadFixture(deploy);
      await register();
      await expect(registry.connect(creator).updateClaim(ISRC, h("payload-v1"), h("claim-v1"), [split("artist", 10000)], b32("split_correction")))
        .to.emit(registry, "ClaimUpdated");
      expect(await registry.versionCount(ISRC)).to.equal(2n);
      expect((await registry.getVersion(ISRC, 0)).payloadHash).to.equal(h("payload-v0"));
      expect((await registry.getVersion(ISRC, 1)).payloadHash).to.equal(h("payload-v1"));
      expect((await registry.verify(ISRC)).version).to.equal(1n);
    });

    it("requires a reason and the claimant or issuer", async () => {
      const { registry, register, stranger, creator } = await loadFixture(deploy);
      await register();
      await expect(registry.connect(stranger).updateClaim(ISRC, h("p"), h("c"), [], b32("x")))
        .to.be.revertedWithCustomError(registry, "NotClaimantOrIssuer");
      await expect(registry.connect(creator).updateClaim(ISRC, h("p"), h("c"), [], ethers.ZeroHash))
        .to.be.revertedWithCustomError(registry, "ReasonRequired");
    });
  });

  describe("UPCs", () => {
    it("appends UPCs for re-releases instead of replacing them", async () => {
      const { registry, asIssuer, register } = await loadFixture(deploy);
      await register();
      await asIssuer.linkUPC(ISRC, "036000291452");   // UPC-A
      await asIssuer.linkUPC(ISRC, "4006381333931");  // EAN-13
      const upcs = await registry.getUPCs(ISRC);
      expect(upcs.length).to.equal(2);
      expect(upcs[0].upcHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes("036000291452")));
    });

    it("rejects bad check digits, letters and wrong lengths", async () => {
      const { registry, asIssuer, register } = await loadFixture(deploy);
      await register();
      for (const bad of ["036000291453", "03600029145A", "12345", "40063813339310"]) {
        await expect(asIssuer.linkUPC(ISRC, bad)).to.be.revertedWithCustomError(registry, "InvalidUPC");
      }
    });
  });

  describe("transfers", () => {
    it("lets the claimant or the issuer transfer", async () => {
      const { registry, asIssuer, register, creator, buyer } = await loadFixture(deploy);
      await register();
      await expect(registry.connect(creator).transferRights(ISRC, buyer.address, h("sale-1")))
        .to.emit(registry, "RightsTransferred").withArgs(await registry.isrcHashOf(ISRC), creator.address, buyer.address, h("sale-1"));
      await asIssuer.transferRights(ISRC, creator.address, h("sale-2"));
      expect((await registry.verify(ISRC)).claimant).to.equal(creator.address);
    });

    it("blocks strangers and missing transfer evidence", async () => {
      const { registry, register, stranger, creator, buyer } = await loadFixture(deploy);
      await register();
      await expect(registry.connect(stranger).transferRights(ISRC, stranger.address, h("x")))
        .to.be.revertedWithCustomError(registry, "NotClaimantOrIssuer");
      await expect(registry.connect(creator).transferRights(ISRC, buyer.address, ethers.ZeroHash))
        .to.be.revertedWithCustomError(registry, "ZeroHash");
    });
  });

  describe("disputes", () => {
    it("strangers cannot freeze a recording", async () => {
      const { registry, register, stranger } = await loadFixture(deploy);
      await register();
      await expect(registry.connect(stranger).openDispute(ISRC, b32("conflict"), h("ev")))
        .to.be.revertedWithCustomError(registry, "NotAllowedToDispute");
    });

    it("a dispute freezes transfers and claim updates until resolved", async () => {
      const { registry, register, reporter, creator, buyer, admin } = await loadFixture(deploy);
      await register();
      await registry.connect(reporter).openDispute(ISRC, b32("conflicting_ownership"), h("ev"));
      expect((await registry.verify(ISRC)).status).to.equal(Status.Disputed);
      await expect(registry.connect(creator).transferRights(ISRC, buyer.address, h("x")))
        .to.be.revertedWithCustomError(registry, "NotActive");
      await expect(registry.connect(creator).updateClaim(ISRC, h("p"), h("c"), [], b32("x")))
        .to.be.revertedWithCustomError(registry, "NotActive");
      await expect(registry.connect(admin).resolveDispute(ISRC, b32("upheld_original"), Status.Active))
        .to.emit(registry, "DisputeResolved");
      expect((await registry.verify(ISRC)).status).to.equal(Status.Active);
    });

    it("can revoke an invalid claim but keeps its history", async () => {
      const { registry, register, creator, admin } = await loadFixture(deploy);
      await register();
      await registry.connect(creator).openDispute(ISRC, b32("self_report"), ethers.ZeroHash);
      await registry.connect(admin).resolveDispute(ISRC, b32("invalid_assignment"), Status.Revoked);
      const v = await registry.verify(ISRC);
      expect(v.status).to.equal(Status.Revoked);
      expect(v.payloadHash).to.equal(h("payload-v0"));
      await expect(registry.connect(admin).resolveDispute(ISRC, b32("x"), Status.Active))
        .to.be.revertedWithCustomError(registry, "NoOpenDispute");
    });

    it("only an arbiter resolves, and only to Active or Revoked", async () => {
      const { registry, register, creator, admin } = await loadFixture(deploy);
      await register();
      await registry.connect(creator).openDispute(ISRC, b32("x"), ethers.ZeroHash);
      await expect(registry.connect(creator).resolveDispute(ISRC, b32("x"), Status.Active))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(registry.connect(admin).resolveDispute(ISRC, b32("x"), Status.Frozen))
        .to.be.revertedWithCustomError(registry, "BadStatusTransition");
    });
  });

  describe("status transitions", () => {
    it("allows freeze and unfreeze, and treats Revoked and Superseded as final", async () => {
      const { registry, register, admin } = await loadFixture(deploy);
      await register();
      const arb = registry.connect(admin);
      await arb.setStatus(ISRC, Status.Frozen, b32("legal_hold"));
      await arb.setStatus(ISRC, Status.Active, b32("hold_lifted"));
      await arb.setStatus(ISRC, Status.Superseded, b32("corrected_isrc"));
      await expect(arb.setStatus(ISRC, Status.Active, b32("x"))).to.be.revertedWithCustomError(registry, "BadStatusTransition");
      await register(REMIX);
      await arb.setStatus(REMIX, Status.Revoked, b32("x"));
      await expect(arb.setStatus(REMIX, Status.Active, b32("x"))).to.be.revertedWithCustomError(registry, "BadStatusTransition");
    });

    it("cannot open a dispute through setStatus", async () => {
      const { registry, register, admin } = await loadFixture(deploy);
      await register();
      await expect(registry.connect(admin).setStatus(ISRC, Status.Disputed, b32("x")))
        .to.be.revertedWithCustomError(registry, "BadStatusTransition");
    });
  });

  describe("pause", () => {
    it("blocks writes while paused, keeps reads", async () => {
      const { registry, register, admin, stranger } = await loadFixture(deploy);
      await register();
      await expect(registry.connect(stranger).pause()).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await registry.connect(admin).pause();
      await expect(register(REMIX)).to.be.revertedWithCustomError(registry, "EnforcedPause");
      expect((await registry.verify(ISRC)).found).to.equal(true);
      await registry.connect(admin).unpause();
      await register(REMIX);
    });
  });

  describe("gas", () => {
    it("registers with 4 splits under 400k gas", async () => {
      const { register } = await loadFixture(deploy);
      const splits = [split("label", 10000, "master"), split("w1", 3400, "publishing"), split("w2", 3300, "publishing"), split("w3", 3300, "publishing")];
      const receipt = await (await register(ISRC, splits)).wait();
      console.log("      registerRecording (4 splits) gas:", receipt.gasUsed.toString());
      expect(receipt.gasUsed).to.be.lessThan(400000n);
    });
  });
});
