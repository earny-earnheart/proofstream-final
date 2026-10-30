// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IValueTransferPolicy {
    function canTransfer(address from, address to, uint256 slot, uint256 value) external view returns (bool);
}

/// @notice Integration primitive. Does NOT itself intercept an ERC-3525 implementation.
/// Wire into the concrete token's common pre-mutation hook for certificate transfers,
/// value transfers to IDs AND addresses, mint, burn, split, merge, and recovery.
abstract contract Compliance3525Hook {
    IValueTransferPolicy public immutable transferPolicy;
    error TransferNotPermitted();

    constructor(address policy) {
        require(policy.code.length != 0, "Policy must be a contract");
        transferPolicy = IValueTransferPolicy(policy);
    }

    function _checkBondTransfer(address from, address to, uint256 slot, uint256 value) internal view {
        if (!transferPolicy.canTransfer(from, to, slot, value)) revert TransferNotPermitted();
    }
}
