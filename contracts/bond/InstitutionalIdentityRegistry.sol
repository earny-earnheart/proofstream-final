// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Governed identity attestations; compatible with isVerified, not full T-REX.
contract InstitutionalIdentityRegistry is Ownable2Step {
    mapping(address => uint64) public validUntil;
    event IdentityUpdated(address indexed wallet, uint64 validUntil, bytes32 evidenceHash);
    constructor(address admin) Ownable(admin) {}
    function setIdentity(address wallet, uint64 expiry, bytes32 evidenceHash) external onlyOwner {
        require(wallet != address(0), "Zero wallet");
        require(expiry == 0 || (expiry > block.timestamp && evidenceHash != bytes32(0)), "Invalid identity");
        validUntil[wallet] = expiry;
        emit IdentityUpdated(wallet, expiry, evidenceHash);
    }
    function isVerified(address wallet) external view returns (bool) {
        return wallet != address(0) && validUntil[wallet] > block.timestamp;
    }
}
