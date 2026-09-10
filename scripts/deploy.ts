import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("─".repeat(60));
  console.log("ProofStream deployment");
  console.log("─".repeat(60));
  console.log("network          :", hre.network.name, `(chainId ${network.chainId})`);
  console.log("deployer         :", deployer.address);
  console.log("balance          :", ethers.formatEther(balance), "ETH");

  const Factory = await ethers.getContractFactory("ProofStream");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  const registrationFee = await contract.registrationFee();
  const witnessFee = await contract.witnessAttestationFee();

  console.log("─".repeat(60));
  console.log("address          :", address);
  console.log("tx hash          :", deployTx?.hash ?? "(unknown)");
  console.log("block            :", receipt?.blockNumber ?? "(unknown)");
  console.log("registrationFee  :", ethers.formatEther(registrationFee), "ETH");
  console.log("witnessFee       :", ethers.formatEther(witnessFee), "ETH");
  console.log("─".repeat(60));
  console.log("Next: /verify-and-tag", hre.network.name === "arbitrum-sepolia" ? "arbitrum" : hre.network.name, address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
