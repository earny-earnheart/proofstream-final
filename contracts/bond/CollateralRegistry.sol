// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Authorized valuation assertions, not proof of a bank obligation or statutory credit.
contract CollateralRegistry is Ownable2Step, EIP712 {
    struct Attestation {
        bytes32 id;
        uint64 expiry;
        uint64 revision;
        uint256 eligibleBalance;
        uint256 requiredBalance;
        bytes3 currency;
        bytes32 documentHash;
        bytes32 locatorHash;
        uint64 observedAt;
        uint64 deadline;
        uint256 nonce;
    }
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256("CollateralAttestation(bytes32 id,uint64 expiry,uint64 revision,uint256 eligibleBalance,uint256 requiredBalance,bytes3 currency,bytes32 documentHash,bytes32 locatorHash,uint64 observedAt,uint64 deadline,uint256 nonce)");
    mapping(address => bool) public attestors;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => Attestation) private records;
    event AttestorUpdated(address indexed signer, bool authorized);
    event CollateralUpdated(bytes32 indexed id, uint64 revision, address indexed signer, bytes32 digest);
    constructor(address admin) Ownable(admin) EIP712("ProofStream Collateral", "1") {}
    function setAttestor(address signer, bool authorized) external onlyOwner {
        require(signer != address(0), "Zero signer");
        attestors[signer] = authorized; emit AttestorUpdated(signer, authorized);
    }
    function digest(Attestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, a)));
    }
    function submit(Attestation calldata a, address signer, bytes calldata signature) external {
        require(attestors[signer], "Unauthorized attestor");
        require(a.id != bytes32(0) && a.documentHash != bytes32(0) && a.locatorHash != bytes32(0), "Missing evidence");
        require(a.observedAt <= block.timestamp && block.timestamp - a.observedAt <= 1 hours, "Stale observation");
        require(a.deadline >= block.timestamp && a.deadline >= a.observedAt, "Expired signature");
        require(a.expiry != 0 && a.revision == records[a.id].revision + 1, "Invalid revision");
        require(a.observedAt >= records[a.id].observedAt, "Older observation");
        for (uint256 i; i < 3; ++i) require(a.currency[i] >= 0x41 && a.currency[i] <= 0x5a, "Invalid currency");
        require(records[a.id].revision == 0 || records[a.id].currency == a.currency, "Currency changed");
        require(a.nonce == nonces[signer], "Invalid nonce");
        bytes32 signedDigest = digest(a);
        require(SignatureChecker.isValidSignatureNow(signer, signedDigest, signature), "Invalid signature");
        nonces[signer]++;
        records[a.id] = a;
        emit CollateralUpdated(a.id, a.revision, signer, signedDigest);
    }
    function getLOC(bytes32 id) external view returns (uint64 expiry, uint64 revision, uint256 eligibleBalance, uint256 requiredBalance, string memory currency, uint64 observedAt) {
        Attestation storage a = records[id];
        require(a.revision != 0, "Unknown LOC");
        return (a.expiry, a.revision, a.eligibleBalance, a.requiredBalance, string(abi.encodePacked(a.currency)), a.observedAt);
    }
    function getEvidence(bytes32 id) external view returns (bytes32 documentHash, bytes32 locatorHash) {
        require(records[id].revision != 0, "Unknown LOC");
        return (records[id].documentHash, records[id].locatorHash);
    }
}
