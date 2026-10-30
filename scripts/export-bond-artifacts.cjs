const hre = require('hardhat');
const fs = require('node:fs/promises');
async function main() {
  const { contractNames } = await import('./bond-deployment.mjs');
  const output = {};
  for (const name of contractNames) {
    const artifact = await hre.artifacts.readArtifact(name);
    output[name] = { abi: artifact.abi, bytecode: artifact.bytecode };
  }
  await fs.mkdir('artifacts/bond-bundle', { recursive: true });
  await fs.writeFile('artifacts/bond-bundle/contracts.json', JSON.stringify(output, null, 2) + '\n');
  console.log('Exported artifacts/bond-bundle/contracts.json');
}
main().catch(() => { console.error('Artifact export failed'); process.exitCode = 1; });
