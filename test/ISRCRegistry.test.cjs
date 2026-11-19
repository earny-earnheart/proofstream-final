const { expect } = require("chai");
const { ethers } = require("hardhat");
const { isrcKey, upcKey, payloadHash, normalizeIsrc, normalizeUpc } = require("../scripts/isrc-hashing.cjs");

const S = { None: 0, Registered: 1, Disputed: 2, Superseded: 3 };

describe("ProofStreamISRCRegistry", function () {
  let reg, admin, issuer, arbiter, artist, buyer, rando;
  const K1 = isrcKey("US-SKG-26-12345");
  const K2 = isrcKey("US-SKG-26-12346");
  const rec = { isrc: "USSKG2612345", title: "Test", version: "original", duration_ms: 201000 };
  const P1 = payloadHash(rec);
  const C1 = payloadHash({ claims: [{ role: "master_owner", split_bps: 10000 }] });
  const P2 = payloadHash({ ...rec, title: "Test (Corrected)" });

  beforeEach(async () => {
    [admin, issuer, arbiter, artist, buyer, rando] = await ethers.getSigners();
    reg = await ethers.deployContract("ProofStreamISRCRegistry", [admin.address, issuer.address, arbiter.address]);
    await reg.connect(issuer).registerRecording(K1, P1, C1, artist.address);
  });

  describe("hashing helpers", () => {
    it("normalizes ISRC and matches on-chain key", async () => {
      expect(normalizeIsrc("us-skg-26-12345")).to.equal("USSKG2612345");
      expect(await reg.isrcKeyOf("USSKG2612345")).to.equal(K1);
      expect(() => normalizeIsrc("US-SKG-26-1234")).to.throw();
    });
    it("canonical JSON hash ignores key order", () => {
      expect(payloadHash({ b: 1, a: 2 })).to.equal(payloadHash({ a: 2, b: 1 }));
    });
    it("matches RFC 8785 canonical output", () => {
      const { canonicalize } = require("../scripts/isrc-hashing.cjs");
      expect(canonicalize({ b: [1, { d: true, c: null }], a: "\u00e9", n: 1e21, z: 0.1 }))
        .to.equal('{"a":"\u00e9","b":[1,{"c":null,"d":true}],"n":1e+21,"z":0.1}');
    });
    it("rejects lone surrogates in values and keys (RFC 8785 3.2.2.2)", () => {
      expect(() => payloadHash({ title: "\ud800" })).to.throw(/lone surrogate/);
      expect(() => payloadHash({ ["\udc00"]: 1 })).to.throw(/lone surrogate/);
      expect(() => payloadHash({ title: "a\ud83c\udfb5b" })).to.not.throw(); // valid pair
    });
    it("validates UPC check digit", () => {
      expect(normalizeUpc("036000291452")).to.equal("0036000291452");
      expect(() => normalizeUpc("036000291453")).to.throw();
    });
  });

  describe("registration", () => {
    it("records claimant, version 0, status", async () => {
      const v = await reg.verify(K1);
      expect(v.payloadHash).to.equal(P1);
      expect(v.claimHash).to.equal(C1);
      expect(v.claimant).to.equal(artist.address);
      expect(v.status).to.equal(S.Registered);
      expect(v.versionCount).to.equal(1);
    });
    it("rejects duplicate ISRC", async () => {
      await expect(reg.connect(issuer).registerRecording(K1, P2, C1, buyer.address))
        .to.be.revertedWithCustomError(reg, "AlreadyRegistered");
    });
    it("only issuer can register", async () => {
      await expect(reg.connect(rando).registerRecording(K2, P1, C1, artist.address))
        .to.be.revertedWithCustomError(reg, "AccessControlUnauthorizedAccount");
    });
    it("batch registers and checks lengths", async () => {
      const K3 = isrcKey("USSKG2612347");
      await reg.connect(issuer).registerBatch([K2, K3], [P1, P2], [C1, C1], [artist.address, buyer.address]);
      expect((await reg.verify(K3)).claimant).to.equal(buyer.address);
      await expect(reg.connect(issuer).registerBatch([K2], [P1, P2], [C1], [artist.address]))
        .to.be.revertedWithCustomError(reg, "LengthMismatch");
    });
    it("unregistered ISRC reverts on verify", async () => {
      await expect(reg.verify(K2)).to.be.revertedWithCustomError(reg, "NotRegistered");
    });
  });

  describe("updates keep history", () => {
    it("claimant appends version; old version still readable", async () => {
      await expect(reg.connect(artist).updateClaim(K1, P2, C1, "title typo"))
        .to.emit(reg, "ClaimUpdated").withArgs(K1, 1, P2, C1, artist.address, "title typo");
      expect((await reg.verify(K1)).payloadHash).to.equal(P2);
      expect((await reg.getVersion(K1, 0)).payloadHash).to.equal(P1);
    });
    it("strangers cannot update", async () => {
      await expect(reg.connect(rando).updateClaim(K1, P2, C1, "x")).to.be.revertedWithCustomError(reg, "NotAuthorized");
    });
  });

  describe("transfers", () => {
    const T = ethers.id("assignment-agreement");
    it("two-step transfer; buyer inherits history", async () => {
      await reg.connect(artist).proposeTransfer(K1, buyer.address, T);
      await expect(reg.connect(rando).acceptTransfer(K1, T)).to.be.revertedWithCustomError(reg, "NotAuthorized");
      await expect(reg.connect(buyer).acceptTransfer(K1, T))
        .to.emit(reg, "TransferAccepted").withArgs(K1, artist.address, buyer.address, T);
      const v = await reg.verify(K1);
      expect(v.claimant).to.equal(buyer.address);
      expect(v.versionCount).to.equal(1);
    });
    it("claimant can cancel", async () => {
      await reg.connect(artist).proposeTransfer(K1, buyer.address, T);
      await reg.connect(artist).cancelTransfer(K1);
      await expect(reg.connect(buyer).acceptTransfer(K1, T)).to.be.revertedWithCustomError(reg, "NoPendingTransfer");
      expect(await reg.pendingTransferHashOf(K1)).to.equal(ethers.ZeroHash);
    });
    it("acceptance is bound to the agreement the buyer reviewed", async () => {
      const T2 = ethers.id("swapped-agreement");
      await reg.connect(artist).proposeTransfer(K1, buyer.address, T);
      await reg.connect(artist).proposeTransfer(K1, buyer.address, T2); // claimant swaps terms
      await expect(reg.connect(buyer).acceptTransfer(K1, T)).to.be.revertedWithCustomError(reg, "TransferChanged");
      await reg.connect(buyer).acceptTransfer(K1, T2);
      expect((await reg.verify(K1)).claimant).to.equal(buyer.address);
    });
  });

  describe("disputes", () => {
    const R = ethers.id("split dispute");
    it("freezes transfers and claimant edits, clears pending transfer", async () => {
      await reg.connect(artist).proposeTransfer(K1, buyer.address, ethers.id("t"));
      await reg.connect(issuer).openDispute(K1, R);
      expect(await reg.pendingClaimantOf(K1)).to.equal(ethers.ZeroAddress);
      await expect(reg.connect(artist).updateClaim(K1, P2, C1, "x")).to.be.revertedWithCustomError(reg, "RecordDisputed");
      await expect(reg.connect(artist).proposeTransfer(K1, buyer.address, ethers.id("t")))
        .to.be.revertedWithCustomError(reg, "RecordDisputed");
    });
    it("random wallets cannot open disputes", async () => {
      await expect(reg.connect(rando).openDispute(K1, R)).to.be.revertedWithCustomError(reg, "NotAuthorized");
    });
    it("arbiter resolves, appends version, keeps the losing claim", async () => {
      await reg.connect(issuer).openDispute(K1, R);
      const C2 = payloadHash({ claims: [{ role: "master_owner", split_bps: 5000 }, { role: "producer", split_bps: 5000 }] });
      await expect(reg.connect(arbiter).resolveDispute(K1, P1, C2, buyer.address, ethers.id("ruling")))
        .to.emit(reg, "DisputeResolved");
      const v = await reg.verify(K1);
      expect(v.status).to.equal(S.Registered);
      expect(v.claimant).to.equal(buyer.address);
      expect(v.claimHash).to.equal(C2);
      expect((await reg.getVersion(K1, 0)).claimHash).to.equal(C1);
    });
    it("only arbiter resolves", async () => {
      await reg.connect(issuer).openDispute(K1, R);
      await expect(reg.connect(issuer).resolveDispute(K1, P1, C1, artist.address, R))
        .to.be.revertedWithCustomError(reg, "AccessControlUnauthorizedAccount");
    });
  });

  describe("supersede, derivatives, releases, batches", () => {
    beforeEach(async () => reg.connect(issuer).registerRecording(K2, P2, C1, artist.address));

    it("supersedes a duplicate without deleting it", async () => {
      await reg.connect(arbiter).supersede(K2, K1, ethers.id("duplicate"));
      const v = await reg.verify(K2);
      expect(v.status).to.equal(S.Superseded);
      expect(v.supersededBy).to.equal(K1);
      await expect(reg.connect(artist).updateClaim(K2, P1, C1, "x")).to.be.revertedWithCustomError(reg, "RecordSuperseded");
    });
    it("rejects supersede cycles and re-supersede", async () => {
      await reg.connect(arbiter).supersede(K2, K1, ethers.id("duplicate"));
      await expect(reg.connect(arbiter).supersede(K1, K2, ethers.id("reverse")))
        .to.be.revertedWithCustomError(reg, "RecordSuperseded").withArgs(K2);
      const K3 = isrcKey("USSKG2612347");
      await reg.connect(issuer).registerRecording(K3, P1, C1, artist.address);
      await expect(reg.connect(arbiter).supersede(K2, K3, ethers.id("repoint")))
        .to.be.revertedWithCustomError(reg, "RecordSuperseded").withArgs(K2);
    });
    it("links a remix to its parent", async () => {
      await expect(reg.connect(issuer).linkDerivative(K2, K1, ethers.id("remix")))
        .to.emit(reg, "DerivativeLinked").withArgs(K2, K1, ethers.id("remix"));
    });
    it("anchors release versions under one UPC", async () => {
      const U = upcKey("036000291452");
      await reg.connect(issuer).anchorRelease(U, ethers.id("tracklist-v0"));
      await reg.connect(issuer).anchorRelease(U, ethers.id("tracklist-v1"));
      expect(await reg.releaseVersion(U)).to.equal(2);
      expect(await reg.releaseTracklistHash(U)).to.equal(ethers.id("tracklist-v1"));
    });
    it("anchors batch roots with incrementing ids", async () => {
      await expect(reg.connect(issuer).anchorBatch(ethers.id("root0"), 42, "ipfs://cid0"))
        .to.emit(reg, "BatchAnchored").withArgs(0, ethers.id("root0"), 42, "ipfs://cid0");
      await reg.connect(issuer).anchorBatch(ethers.id("root1"), 7, "ipfs://cid1");
      expect(await reg.batchCount()).to.equal(2);
    });
  });

  describe("admin", () => {
    it("pause blocks writes; only admin pauses", async () => {
      await expect(reg.connect(issuer).pause()).to.be.revertedWithCustomError(reg, "AccessControlUnauthorizedAccount");
      await reg.connect(admin).pause();
      await expect(reg.connect(issuer).registerRecording(K2, P1, C1, artist.address))
        .to.be.revertedWithCustomError(reg, "EnforcedPause");
      await reg.connect(admin).unpause();
      await reg.connect(issuer).registerRecording(K2, P1, C1, artist.address);
    });
  });
});
