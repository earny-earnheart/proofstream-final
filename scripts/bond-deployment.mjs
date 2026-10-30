import { BrowserProvider, ContractFactory, getAddress, ZeroAddress, keccak256 } from 'ethers';
export const contractNames = ['InstitutionalIdentityRegistry', 'QIBTransferPolicy', 'CollateralRegistry', 'ProofStreamBond'];
const allowedChains = new Set([31337n, 11155111n, 421614n]);

export function validateRoles(roles) {
  const result = {};
  for (const key of ['governance', 'compliance', 'issuer', 'trustee']) {
    result[key] = getAddress(roles[key]);
    if (result[key] === ZeroAddress) throw new Error(`Zero ${key}`);
  }
  return result;
}

// Checkpoint after every confirmed deployment. Caller must persist the receipt before
// continuing, so a rejected later wallet prompt does not lose earlier addresses.
export async function deployBondSuite(signer, artifacts, roles, expectedChainId, checkpoint) {
  roles = validateRoles(roles);
  const chainId = BigInt(expectedChainId);
  if (!allowedChains.has(chainId)) throw new Error('Only local or supported testnets are enabled');
  if (typeof checkpoint !== 'function') throw new Error('A persistent checkpoint callback is required');
  const deployer = await signer.getAddress();
  const addresses = {};
  for (const name of contractNames) {
    if (!artifacts[name]?.bytecode?.startsWith('0x') || !Array.isArray(artifacts[name].abi)) throw new Error(`Missing artifact: ${name}`);
  }
  async function deploy(name, args) {
    if ((await signer.provider.getNetwork()).chainId !== chainId) throw new Error('Wallet chain changed');
    const artifact = artifacts[name];
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
    const transaction = contract.deploymentTransaction();
    // Save pending tx hash immediately as well as the confirmed receipt.
    await checkpoint({ status: 'submitted', name, chainId: Number(chainId), deployer, txHash: transaction.hash, constructorArguments: args });
    const receipt = await transaction.wait(1);
    if (receipt.status !== 1) throw new Error('Deployment reverted');
    const address = await contract.getAddress();
    const runtime = await signer.provider.getCode(address);
    if (runtime === '0x') throw new Error('Deployment has no code');
    addresses[name] = address;
    await checkpoint({ status: 'confirmed', name, address, chainId: Number(chainId), deployer,
      txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), constructorArguments: args,
      initBytecodeHash: keccak256(artifact.bytecode), runtimeCodeHash: keccak256(runtime) });
  }
  await deploy('InstitutionalIdentityRegistry', [roles.compliance]);
  await deploy('QIBTransferPolicy', [roles.compliance, addresses.InstitutionalIdentityRegistry]);
  await deploy('CollateralRegistry', [roles.governance]);
  await deploy('ProofStreamBond', [roles.governance, roles.issuer, roles.trustee, addresses.QIBTransferPolicy]);
  return addresses;
}

// Import in an existing browser application/bundler. No private key is exported.
// Caller supplies the selected EIP-1193 MetaMask provider (EIP-6963 where available).
export async function deployWithMetaMask(injectedProvider, artifacts, roles, chainId, checkpoint) {
  const provider = new BrowserProvider(injectedProvider);
  if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error('Select the intended testnet in MetaMask');
  const signer = await provider.getSigner();
  return deployBondSuite(signer, artifacts, roles, chainId, checkpoint);
}
