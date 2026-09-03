// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ProofStream.sol";

contract Rejector is Ownable {
    constructor() Ownable(msg.sender) {}

    // Rejects all incoming ETH
    receive() external payable {
        revert("I reject ETH");
    }

    function callWithdraw(address proofStream) external onlyOwner {
        ProofStream(payable(proofStream)).withdraw();
    }
}
