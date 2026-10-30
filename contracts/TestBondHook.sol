// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import "./bond/Compliance3525Hook.sol";

/// @dev Test doubles only; not bond certificates and never intended for public deployment.
contract TestIdentityRegistry {
    mapping(address => bool) public isVerified;
    function setVerified(address who, bool value) external { isVerified[who] = value; }
}

contract TestBondHook is Compliance3525Hook {
    constructor(address policy) Compliance3525Hook(policy) {}
    function check(address from, address to, uint256 slot, uint256 value) external view {
        _checkBondTransfer(from, to, slot, value);
    }
}
