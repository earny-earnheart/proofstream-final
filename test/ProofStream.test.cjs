const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ProofStream", function () {
  let proofStream;
  let owner;
  let creator;
  let creator2;
  let witness;
  let stranger;

  beforeEach(async function () {
    [owner, creator, creator2, witness, stranger] = await ethers.getSigners();

    const ProofStream = await ethers.getContractFactory("ProofStream");
    proofStream = await ProofStream.deploy();
    await proofStream.waitForDeployment();
  });

  const parseProjectHash = (receipt) => {
    const event = receipt.logs.find((log) => {
      try {
        return proofStream.interface.parseLog(log)?.name === "ProjectCreated";
      } catch (_) {
        return false;
      }
    });
    return proofStream.interface.parseLog(event).args[0];
  };

  const createProjectFor = async (signer, name = "My Album", category = "Music", isPublic = true) => {
    const fee = await proofStream.registrationFee();
    const tx = await proofStream.connect(signer).createProject(name, category, isPublic, { value: fee });
    const receipt = await tx.wait();
    return parseProjectHash(receipt);
  };

  const registerMilestoneFor = async (signer, projectHash, contentHash, title = "Draft", stage = "draft") => {
    const fee = await proofStream.registrationFee();
    await proofStream.connect(signer).registerMilestone(
      projectHash, contentHash, title, stage, "", false, { value: fee }
    );
  };

  describe("Deployment", function () {
    it("Should deploy with correct initial values", async function () {
      expect(await proofStream.totalProjects()).to.equal(0);
      expect(await proofStream.totalMilestones()).to.equal(0);
      expect(await proofStream.registrationFee()).to.equal(ethers.parseEther("0.001"));
      expect(await proofStream.witnessAttestationFee()).to.equal(ethers.parseEther("0.001"));
    });

    it("Should set the right owner", async function () {
      expect(await proofStream.owner()).to.equal(owner.address);
    });

    it("Should start unpaused", async function () {
      expect(await proofStream.paused()).to.equal(false);
    });
  });

  describe("Project Creation", function () {
    it("Should create a project successfully", async function () {
      const fee = await proofStream.registrationFee();

      await expect(
        proofStream.connect(creator).createProject("My First Album", "Music", true, { value: fee })
      ).to.emit(proofStream, "ProjectCreated");

      expect(await proofStream.totalProjects()).to.equal(1);
      expect((await proofStream.getCreatorProjects(creator.address)).length).to.equal(1);
    });

    it("Should fail without sufficient fee", async function () {
      await expect(
        proofStream.connect(creator).createProject("Test", "Music", true, { value: 0 })
      ).to.be.revertedWithCustomError(proofStream, "InsufficientFee");
    });

    it("Should fail with empty project ID", async function () {
      const fee = await proofStream.registrationFee();
      await expect(
        proofStream.connect(creator).createProject("", "Music", true, { value: fee })
      ).to.be.revertedWithCustomError(proofStream, "InvalidProjectId");
    });
  });

  describe("Milestone Registration", function () {
    let projectHash;

    beforeEach(async function () {
      projectHash = await createProjectFor(creator);
    });

    it("Should register a milestone", async function () {
      const fee = await proofStream.registrationFee();
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("Song lyrics v1"));

      await expect(
        proofStream.connect(creator).registerMilestone(
          projectHash, contentHash, "First Draft", "draft", "", false, { value: fee }
        )
      ).to.emit(proofStream, "MilestoneRegistered");

      expect(await proofStream.totalMilestones()).to.equal(1);
    });

    it("Should verify registered content for that specific creator", async function () {
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("Song lyrics v1"));
      await registerMilestoneFor(creator, projectHash, contentHash);

      const [exists, timestamp] = await proofStream.verifyContent(creator.address, contentHash);
      expect(exists).to.equal(true);
      expect(timestamp).to.be.gt(0);
    });

    it("Should return false for verifyContent on a different creator", async function () {
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("Song lyrics v1"));
      await registerMilestoneFor(creator, projectHash, contentHash);

      const [exists] = await proofStream.verifyContent(stranger.address, contentHash);
      expect(exists).to.equal(false);
    });

    it("Should fail to register duplicate content from same creator", async function () {
      const fee = await proofStream.registrationFee();
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("Song lyrics v1"));
      await registerMilestoneFor(creator, projectHash, contentHash);

      await expect(
        proofStream.connect(creator).registerMilestone(
          projectHash, contentHash, "Second Draft", "revision", "", false, { value: fee }
        )
      ).to.be.revertedWithCustomError(proofStream, "ContentAlreadyRegistered");
    });

    it("Should fail when non-owner tries to register milestone on someone else's project", async function () {
      const fee = await proofStream.registrationFee();
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("Song lyrics v1"));

      await expect(
        proofStream.connect(witness).registerMilestone(
          projectHash, contentHash, "First Draft", "draft", "", false, { value: fee }
        )
      ).to.be.revertedWithCustomError(proofStream, "NotProjectOwner");
    });

    it("Should reject zero contentHash", async function () {
      const fee = await proofStream.registrationFee();
      await expect(
        proofStream.connect(creator).registerMilestone(
          projectHash, ethers.ZeroHash, "Empty", "draft", "", false, { value: fee }
        )
      ).to.be.revertedWithCustomError(proofStream, "InvalidContentHash");
    });
  });

  describe("Project hash collision", function () {
    it("Reverts when same creator + projectId land in the same block", async function () {
      await ethers.provider.send("evm_setAutomine", [false]);
      try {
        const fee = await proofStream.registrationFee();

        const tx1 = await proofStream.connect(creator).createProject(
          "Collide-Album", "Music", true, { value: fee }
        );
        const tx2 = await proofStream.connect(creator).createProject(
          "Collide-Album", "Music", true, { value: fee }
        );

        await ethers.provider.send("evm_mine", []);

        const receipt1 = await tx1.wait();
        expect(receipt1.status).to.equal(1);

        await expect(tx2.wait()).to.be.rejected;
      } finally {
        await ethers.provider.send("evm_setAutomine", [true]);
      }
    });
  });

  describe("Front-running mitigation (Option A: creator-bound key)", function () {
    it("Two different creators can register the same contentHash independently", async function () {
      const projectAliceHash = await createProjectFor(creator, "Alice Album");
      const projectEveHash = await createProjectFor(creator2, "Eve Album");

      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("contested-content"));

      await registerMilestoneFor(creator, projectAliceHash, contentHash, "Alice's draft");
      await registerMilestoneFor(creator2, projectEveHash, contentHash, "Eve's copy");

      const [aliceExists, aliceTs] = await proofStream.verifyContent(creator.address, contentHash);
      const [eveExists, eveTs] = await proofStream.verifyContent(creator2.address, contentHash);

      expect(aliceExists).to.equal(true);
      expect(eveExists).to.equal(true);
      expect(aliceTs).to.be.gt(0);
      expect(eveTs).to.be.gt(0);
      expect(aliceTs).to.be.lte(eveTs);
    });

    it("Eve's later registration does not overwrite Alice's earlier one", async function () {
      const projectAliceHash = await createProjectFor(creator, "Alice Album");
      const projectEveHash = await createProjectFor(creator2, "Eve Album");

      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("contested-content"));

      await registerMilestoneFor(creator, projectAliceHash, contentHash);
      const [_, aliceTsBefore] = await proofStream.verifyContent(creator.address, contentHash);

      await registerMilestoneFor(creator2, projectEveHash, contentHash);
      const [__, aliceTsAfter] = await proofStream.verifyContent(creator.address, contentHash);

      expect(aliceTsAfter).to.equal(aliceTsBefore);
    });
  });

  describe("Witness System", function () {
    let projectHash;
    let contentHash;

    beforeEach(async function () {
      projectHash = await createProjectFor(creator);
      contentHash = ethers.keccak256(ethers.toUtf8Bytes("Song lyrics v1"));
      await registerMilestoneFor(creator, projectHash, contentHash);
    });

    describe("addWitness", function () {
      it("Should allow creator to designate a witness", async function () {
        await expect(
          proofStream.connect(creator).addWitness(contentHash, witness.address)
        ).to.emit(proofStream, "WitnessAdded")
          .withArgs(contentHash, witness.address, creator.address);

        expect(
          await proofStream.isDesignatedWitness(creator.address, contentHash, witness.address)
        ).to.equal(true);
      });

      it("Should NOT designate a witness on a different creator's regKey when caller has no registration", async function () {
        await expect(
          proofStream.connect(stranger).addWitness(contentHash, witness.address)
        ).to.be.revertedWithCustomError(proofStream, "ContentNotRegistered");
      });

      it("Should fail for unregistered content", async function () {
        const badHash = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));
        await expect(
          proofStream.connect(creator).addWitness(badHash, witness.address)
        ).to.be.revertedWithCustomError(proofStream, "ContentNotRegistered");
      });

      it("Should fail when witness is already designated", async function () {
        await proofStream.connect(creator).addWitness(contentHash, witness.address);
        await expect(
          proofStream.connect(creator).addWitness(contentHash, witness.address)
        ).to.be.revertedWithCustomError(proofStream, "AlreadyDesignated");
      });

      it("Should reject zero-address witness", async function () {
        await expect(
          proofStream.connect(creator).addWitness(contentHash, ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(proofStream, "InvalidAddress");
      });
    });

    describe("attestWitness", function () {
      beforeEach(async function () {
        await proofStream.connect(creator).addWitness(contentHash, witness.address);
      });

      it("Should allow a designated witness to attest", async function () {
        const attestFee = await proofStream.witnessAttestationFee();
        await expect(
          proofStream.connect(witness).attestWitness(creator.address, contentHash, { value: attestFee })
        ).to.emit(proofStream, "WitnessAttested")
          .withArgs(contentHash, creator.address, witness.address, (v) => v > 0n);
      });

      it("Should add attesting witness to getWitnesses result", async function () {
        const attestFee = await proofStream.witnessAttestationFee();
        await proofStream.connect(witness).attestWitness(creator.address, contentHash, { value: attestFee });

        const witnesses = await proofStream.getWitnesses(creator.address, contentHash);
        expect(witnesses.length).to.equal(1);
        expect(witnesses[0]).to.equal(witness.address);
      });

      it("Should fail without sufficient fee", async function () {
        await expect(
          proofStream.connect(witness).attestWitness(creator.address, contentHash, { value: 0 })
        ).to.be.revertedWithCustomError(proofStream, "InsufficientFee");
      });

      it("Should fail if not a designated witness", async function () {
        const attestFee = await proofStream.witnessAttestationFee();
        await expect(
          proofStream.connect(owner).attestWitness(creator.address, contentHash, { value: attestFee })
        ).to.be.revertedWithCustomError(proofStream, "NotDesignatedWitness");
      });

      it("Should fail if witness has already attested", async function () {
        const attestFee = await proofStream.witnessAttestationFee();
        await proofStream.connect(witness).attestWitness(creator.address, contentHash, { value: attestFee });
        await expect(
          proofStream.connect(witness).attestWitness(creator.address, contentHash, { value: attestFee })
        ).to.be.revertedWithCustomError(proofStream, "AlreadyAttested");
      });

      it("Should fail on a creator with no registration", async function () {
        const attestFee = await proofStream.witnessAttestationFee();
        await expect(
          proofStream.connect(witness).attestWitness(stranger.address, contentHash, { value: attestFee })
        ).to.be.revertedWithCustomError(proofStream, "ContentNotRegistered");
      });
    });

    describe("getWitnesses", function () {
      it("Should return empty array before any attestation", async function () {
        const witnesses = await proofStream.getWitnesses(creator.address, contentHash);
        expect(witnesses.length).to.equal(0);
      });

      it("Should fail for unregistered content", async function () {
        const badHash = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));
        await expect(
          proofStream.getWitnesses(creator.address, badHash)
        ).to.be.revertedWithCustomError(proofStream, "ContentNotRegistered");
      });
    });

    describe("verifyWitness", function () {
      it("Should return false before attestation", async function () {
        const [attested, attestedAt] = await proofStream.verifyWitness(
          creator.address, contentHash, witness.address
        );
        expect(attested).to.equal(false);
        expect(attestedAt).to.equal(0);
      });

      it("Should return true with timestamp after attestation", async function () {
        await proofStream.connect(creator).addWitness(contentHash, witness.address);
        const attestFee = await proofStream.witnessAttestationFee();
        await proofStream.connect(witness).attestWitness(creator.address, contentHash, { value: attestFee });

        const [attested, attestedAt] = await proofStream.verifyWitness(
          creator.address, contentHash, witness.address
        );
        expect(attested).to.equal(true);
        expect(attestedAt).to.be.gt(0);
      });
    });
  });

  describe("Fee management", function () {
    it("Should let owner update registrationFee and emit event", async function () {
      const oldFee = await proofStream.registrationFee();
      const newFee = ethers.parseEther("0.002");

      await expect(proofStream.connect(owner).setRegistrationFee(newFee))
        .to.emit(proofStream, "RegistrationFeeUpdated")
        .withArgs(oldFee, newFee);

      expect(await proofStream.registrationFee()).to.equal(newFee);
    });

    it("Should reject non-owner setting registrationFee", async function () {
      await expect(
        proofStream.connect(creator).setRegistrationFee(ethers.parseEther("0.002"))
      ).to.be.revertedWithCustomError(proofStream, "OwnableUnauthorizedAccount");
    });

    it("Should let owner update witnessAttestationFee and emit event", async function () {
      const oldFee = await proofStream.witnessAttestationFee();
      const newFee = ethers.parseEther("0.005");

      await expect(proofStream.connect(owner).setWitnessAttestationFee(newFee))
        .to.emit(proofStream, "WitnessAttestationFeeUpdated")
        .withArgs(oldFee, newFee);

      expect(await proofStream.witnessAttestationFee()).to.equal(newFee);
    });

    it("Should reject non-owner setting witnessAttestationFee", async function () {
      await expect(
        proofStream.connect(creator).setWitnessAttestationFee(ethers.parseEther("0.005"))
      ).to.be.revertedWithCustomError(proofStream, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pause / unpause", function () {
    it("Owner can pause and unpause", async function () {
      await proofStream.connect(owner).pause();
      expect(await proofStream.paused()).to.equal(true);

      await proofStream.connect(owner).unpause();
      expect(await proofStream.paused()).to.equal(false);
    });

    it("Non-owner cannot pause", async function () {
      await expect(
        proofStream.connect(creator).pause()
      ).to.be.revertedWithCustomError(proofStream, "OwnableUnauthorizedAccount");
    });

    it("Non-owner cannot unpause", async function () {
      await proofStream.connect(owner).pause();
      await expect(
        proofStream.connect(creator).unpause()
      ).to.be.revertedWithCustomError(proofStream, "OwnableUnauthorizedAccount");
    });

    it("createProject is blocked while paused", async function () {
      await proofStream.connect(owner).pause();
      const fee = await proofStream.registrationFee();
      await expect(
        proofStream.connect(creator).createProject("Album", "Music", true, { value: fee })
      ).to.be.revertedWithCustomError(proofStream, "EnforcedPause");
    });

    it("registerMilestone is blocked while paused", async function () {
      const projectHash = await createProjectFor(creator);
      await proofStream.connect(owner).pause();

      const fee = await proofStream.registrationFee();
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("paused-test"));

      await expect(
        proofStream.connect(creator).registerMilestone(
          projectHash, contentHash, "x", "x", "", false, { value: fee }
        )
      ).to.be.revertedWithCustomError(proofStream, "EnforcedPause");
    });

    it("addWitness and attestWitness are blocked while paused", async function () {
      const projectHash = await createProjectFor(creator);
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("paused-witness"));
      await registerMilestoneFor(creator, projectHash, contentHash);
      await proofStream.connect(creator).addWitness(contentHash, witness.address);

      await proofStream.connect(owner).pause();

      await expect(
        proofStream.connect(creator).addWitness(contentHash, stranger.address)
      ).to.be.revertedWithCustomError(proofStream, "EnforcedPause");

      const attestFee = await proofStream.witnessAttestationFee();
      await expect(
        proofStream.connect(witness).attestWitness(creator.address, contentHash, { value: attestFee })
      ).to.be.revertedWithCustomError(proofStream, "EnforcedPause");
    });

    it("Owner can still withdraw while paused (admin path unaffected)", async function () {
      const projectHash = await createProjectFor(creator);
      const contentHash = ethers.keccak256(ethers.toUtf8Bytes("for-withdraw"));
      await registerMilestoneFor(creator, projectHash, contentHash);

      await proofStream.connect(owner).pause();

      await expect(proofStream.connect(owner).withdraw())
        .to.emit(proofStream, "Withdrawal");
    });
  });

  describe("Direct ETH transfers and overpayment", function () {
    it("Accepts direct ETH via receive() and contract balance grows", async function () {
      const addr = await proofStream.getAddress();
      const before = await ethers.provider.getBalance(addr);
      const amount = ethers.parseEther("0.05");

      await stranger.sendTransaction({ to: addr, value: amount });

      const after = await ethers.provider.getBalance(addr);
      expect(after - before).to.equal(amount);
    });

    it("Direct-transferred ETH is withdrawable by owner", async function () {
      const addr = await proofStream.getAddress();
      const amount = ethers.parseEther("0.1");
      await stranger.sendTransaction({ to: addr, value: amount });

      await expect(proofStream.connect(owner).withdraw())
        .to.emit(proofStream, "Withdrawal")
        .withArgs(owner.address, amount);
    });

    it("Overpaying registrationFee succeeds and the surplus is retained by the contract (no refund)", async function () {
      const fee = await proofStream.registrationFee();
      const overpay = fee * 5n;
      const addr = await proofStream.getAddress();

      const before = await ethers.provider.getBalance(addr);
      await proofStream.connect(creator).createProject("Overpay-Album", "Music", true, { value: overpay });
      const after = await ethers.provider.getBalance(addr);

      expect(after - before).to.equal(overpay);
    });
  });

  describe("Withdrawal", function () {
    it("Should allow owner to withdraw funds and emit event", async function () {
      const fee = await proofStream.registrationFee();

      await proofStream.connect(creator).createProject("My Album", "Music", true, { value: fee });

      const contractBalance = await ethers.provider.getBalance(await proofStream.getAddress());
      expect(contractBalance).to.equal(fee);

      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await proofStream.connect(owner).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

      expect(ownerBalanceAfter).to.be.closeTo(
        ownerBalanceBefore + fee - gasUsed,
        ethers.parseEther("0.0001")
      );

      await proofStream.connect(creator).createProject("Another", "Music", true, { value: fee });
      await expect(proofStream.connect(owner).withdraw())
        .to.emit(proofStream, "Withdrawal")
        .withArgs(owner.address, fee);
    });

    it("Should fail when non-owner tries to withdraw", async function () {
      await expect(
        proofStream.connect(creator).withdraw()
      ).to.be.revertedWithCustomError(proofStream, "OwnableUnauthorizedAccount");
    });

    it("Should fail when there are no funds to withdraw", async function () {
      await expect(
        proofStream.connect(owner).withdraw()
      ).to.be.revertedWithCustomError(proofStream, "NoFunds");
    });

    it("Should fail if the transfer fails (WithdrawalFailed)", async function () {
      const Rejector = await ethers.getContractFactory("Rejector");
      const rejector = await Rejector.deploy();
      await rejector.waitForDeployment();

      // Transfer ownership to the rejector contract
      await proofStream.connect(owner).transferOwnership(await rejector.getAddress());

      // Add some funds to the contract
      const fee = await proofStream.registrationFee();
      await proofStream.connect(creator).createProject("For Rejection", "Test", true, { value: fee });

      // Call withdraw via the rejector contract.
      // The withdraw call will attempt to send ETH to the rejector, which will revert.
      await expect(
        rejector.callWithdraw(await proofStream.getAddress())
      ).to.be.revertedWithCustomError(proofStream, "WithdrawalFailed");
    });
  });

  describe("Additional Coverage", function () {
    it("getProject returns correct data", async function () {
      const fee = await proofStream.registrationFee();
      const tx = await proofStream.connect(creator).createProject("Project A", "Category A", false, { value: fee });
      const receipt = await tx.wait();
      const projectHash = parseProjectHash(receipt);

      const [projectId, projectCreator, createdAt, milestoneCount, isPublic, category] = await proofStream.getProject(projectHash);
      
      expect(projectId).to.equal("Project A");
      expect(projectCreator).to.equal(creator.address);
      expect(createdAt).to.be.gt(0);
      expect(milestoneCount).to.equal(0);
      expect(isPublic).to.equal(false);
      expect(category).to.equal("Category A");
    });

    it("totalProjects and totalMilestones increment correctly", async function () {
      const fee = await proofStream.registrationFee();
      
      const tx1 = await proofStream.connect(creator).createProject("P1", "C1", true, { value: fee });
      const h1 = parseProjectHash(await tx1.wait());
      
      const tx2 = await proofStream.connect(creator2).createProject("P2", "C2", true, { value: fee });
      const h2 = parseProjectHash(await tx2.wait());

      expect(await proofStream.totalProjects()).to.equal(2);

      await registerMilestoneFor(creator, h1, ethers.keccak256(ethers.toUtf8Bytes("M1")));
      await registerMilestoneFor(creator, h1, ethers.keccak256(ethers.toUtf8Bytes("M2")));
      await registerMilestoneFor(creator2, h2, ethers.keccak256(ethers.toUtf8Bytes("M3")));

      expect(await proofStream.totalMilestones()).to.equal(3);
    });
  });
});
