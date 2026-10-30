// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
interface ITestBond {
    function transferFrom(uint256 from, uint256 to, uint256 value) external payable;
}
contract BondReceiver {
    address public bond;
    uint256 public destination;
    bool public reentrySucceeded;
    bool public reject;
    function configure(address token, uint256 destinationId, bool shouldReject) external {
        bond = token; destination = destinationId; reject = shouldReject;
    }
    function supportsInterface(bytes4) external pure returns (bool) { return true; }
    function onERC3525Received(address, uint256, uint256 toId, uint256 value, bytes calldata) external returns (bytes4) {
        (reentrySucceeded,) = bond.call(abi.encodeWithSignature("transferFrom(uint256,uint256,uint256)", toId, destination, value));
        return reject ? bytes4(0) : this.onERC3525Received.selector;
    }
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        return reject ? bytes4(0) : this.onERC721Received.selector;
    }
}
contract Test1271Attestor {
    bytes32 public acceptedDigest;
    function setDigest(bytes32 value) external { acceptedDigest = value; }
    function isValidSignature(bytes32 value, bytes calldata) external view returns (bytes4) {
        return value == acceptedDigest ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
