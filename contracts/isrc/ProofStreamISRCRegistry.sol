// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ISRCRegistryModule} from "./ISRCRegistryModule.sol";

/// @title ProofStreamISRCRegistry
/// @notice Standalone ISRC provenance registry. Deployed alongside ProofStream.sol, not merged into it.
/// @dev ProofStream.sol is a self-serve, creator-signed, fee-paying contract (Ownable).
///      This registry is issuer-batched with role-based arbitration (AccessControl).
///      Separate contracts keep the two trust models from colliding, and ProofStream.sol
///      (already deployed and verified on Sepolia) stays unchanged. Cross-link off-chain:
///      the canonical recording record carries the ProofStream regKey / contentHash.
contract ProofStreamISRCRegistry is ISRCRegistryModule {
    constructor(address admin, address issuer, address arbiter) ISRCRegistryModule(admin, issuer, arbiter) {}
}
