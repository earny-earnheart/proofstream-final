// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Compatible with the read surface of a T-REX identity registry.
interface IVerifiedIdentityRegistry {
    function isVerified(address wallet) external view returns (bool);
}

/// @notice Prototype policy, not an ERC-3643 token or a determination of legal eligibility.
/// Identity verification and time-limited QIB approval are independent requirements.
contract QIBTransferPolicy is Ownable {
    IVerifiedIdentityRegistry public immutable identityRegistry;
    mapping(address => uint64) public qibValidUntil;
    mapping(address => bool) public frozen;
    bool public paused;

    event EligibilityUpdated(address indexed wallet, uint64 validUntil, bytes32 evidenceHash);
    event FreezeUpdated(address indexed wallet, bool frozen);
    event PauseUpdated(bool paused);

    constructor(address admin, address registry) Ownable(admin) {
        require(registry.code.length != 0, "Registry must be a contract");
        identityRegistry = IVerifiedIdentityRegistry(registry);
    }

    function setQIB(address wallet, uint64 validUntil, bytes32 evidenceHash) external onlyOwner {
        require(wallet != address(0), "Zero wallet");
        require(validUntil == 0 || (validUntil > block.timestamp && evidenceHash != bytes32(0)), "Invalid approval");
        qibValidUntil[wallet] = validUntil;
        emit EligibilityUpdated(wallet, validUntil, evidenceHash);
    }

    function setFrozen(address wallet, bool value) external onlyOwner {
        frozen[wallet] = value;
        emit FreezeUpdated(wallet, value);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseUpdated(value);
    }

    function eligible(address wallet) public view returns (bool) {
        return wallet != address(0) && !frozen[wallet] && qibValidUntil[wallet] > block.timestamp
            && identityRegistry.isVerified(wallet);
    }

    /// @dev Zero is allowed for mint/burn endpoints only. Token must restrict those operations.
    /// Reverting or unavailable registries fail closed. slot/value reserved for future policies.
    function canTransfer(address from, address to, uint256, uint256) external view returns (bool) {
        return !paused && (from != address(0) || to != address(0))
            && (from == address(0) || eligible(from)) && (to == address(0) || eligible(to));
    }
}
