export const collateralTypes = {
  CollateralAttestation: [
    ['id', 'bytes32'], ['expiry', 'uint64'], ['revision', 'uint64'],
    ['eligibleBalance', 'uint256'], ['requiredBalance', 'uint256'], ['currency', 'bytes3'],
    ['documentHash', 'bytes32'], ['locatorHash', 'bytes32'], ['observedAt', 'uint64'],
    ['deadline', 'uint64'], ['nonce', 'uint256'],
  ].map(([name, type]) => ({ name, type })),
};
export function collateralDomain(chainId, verifyingContract) {
  return { name: 'ProofStream Collateral', version: '1', chainId, verifyingContract };
}
