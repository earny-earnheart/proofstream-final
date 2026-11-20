// Deploys ProofStreamRegistry and appends the result to deployments/<network>.json.
//   npx hardhat run scripts/deploy-registry.cjs --network base-sepolia
// REGISTRY_ADMIN: the multisig that will hold DEFAULT_ADMIN_ROLE (defaults to the deployer
//                 on testnets only). REGISTRY_ISSUER: optional API signer granted ISSUER_ROLE.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const testnet = [31337n, 11155111n, 84532n, 421614n, 80002n].includes(network.chainId);
  const admin = process.env.REGISTRY_ADMIN || (testnet ? deployer.address : "");
  if (!admin) throw new Error("Set REGISTRY_ADMIN to a multisig before deploying to mainnet.");

  console.log("─".repeat(60));
  console.log("ProofStreamRegistry deployment");
  console.log("network  :", hre.network.name, `(chainId ${network.chainId})`);
  console.log("deployer :", deployer.address);
  console.log("balance  :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("admin    :", admin);

  const registry = await (await ethers.getContractFactory("ProofStreamRegistry")).deploy(admin);
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const receipt = await registry.deploymentTransaction().wait();

  if (process.env.REGISTRY_ISSUER) {
    if (admin !== deployer.address) {
      console.log("issuer   : grant ISSUER_ROLE to", process.env.REGISTRY_ISSUER, "from the admin multisig");
    } else {
      await (await registry.grantRole(await registry.ISSUER_ROLE(), process.env.REGISTRY_ISSUER)).wait();
      console.log("issuer   :", process.env.REGISTRY_ISSUER);
    }
  }

  console.log("address  :", address);
  console.log("tx hash  :", receipt.hash);
  console.log("block    :", receipt.blockNumber);
  console.log("─".repeat(60));

  if (hre.network.name === "hardhat") return;
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  const log = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { network: hre.network.name, chainId: Number(network.chainId), history: [] };
  log.history.push({
    contract: "ProofStreamRegistry",
    address,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    deployer: deployer.address,
    admin,
    compiledAt: new Date().toISOString(),
    verified: false,
  });
  fs.writeFileSync(file, JSON.stringify(log, null, 2) + "\n");
  console.log("Recorded in", path.relative(process.cwd(), file));
  console.log(`Verify: npx hardhat verify --network ${hre.network.name} ${address} ${admin}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
