// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ISRCRegistryModule
/// @notice ISRC provenance registry for ProofStream. Deployed via ProofStreamISRCRegistry.sol.
/// @dev Design rules:
///  - SoundExchange / IFPI stay the authority for the ISRC itself. This contract records
///    who claimed what, when, and every change after that.
///  - History is append-only. No function deletes or overwrites a version.
///  - Only hashes go on-chain. Contracts, split sheets, and PII stay off-chain (IPFS vault, encrypted).
///  - Hash conventions (must match the API spec exactly, or verification fails):
///      isrcKey     = keccak256(bytes(normalized ISRC))   e.g. "USSKG2612345" (12 chars, uppercase, no hyphens)
///      upcKey      = keccak256(bytes(13-digit GTIN))      UPC-A left-padded with one zero
///      payloadHash = sha256(RFC 8785 JCS canonical JSON of the recording record)
///      claimHash   = sha256(RFC 8785 JCS canonical JSON of the rights_claim set)
///  - Not upgradeable on purpose. A proxy lets the admin swap logic, which undercuts
///    "verify without trusting ProofStream." Ship a V2 contract and anchor a migration event instead.
abstract contract ISRCRegistryModule is AccessControl, Pausable {
    // ─────────────────────────────── Roles ───────────────────────────────
    /// @notice Backend batcher. Registers recordings, anchors releases and batches.
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    /// @notice Resolves disputes and supersedes duplicate ISRCs.
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    // DEFAULT_ADMIN_ROLE should be a Safe 2-of-3 multisig, never an EOA.

    // ─────────────────────────────── Types ───────────────────────────────
    enum Status {
        None,
        Registered,
        Disputed,
        Superseded
    }

    struct Version {
        bytes32 payloadHash;
        bytes32 claimHash;
        address actor;
        uint64 anchoredAt;
    }

    struct Record {
        address claimant;
        address pendingClaimant;
        Status status;
        uint32 versionCount;
        bytes32 supersededBy;
    }

    // ─────────────────────────────── Storage ─────────────────────────────
    mapping(bytes32 isrcKey => Record) internal _records;
    mapping(bytes32 isrcKey => mapping(uint256 index => Version)) internal _versions;

    mapping(bytes32 upcKey => bytes32) public releaseTracklistHash;
    mapping(bytes32 upcKey => uint32) public releaseVersion;

    uint256 public batchCount;
    mapping(uint256 batchId => bytes32) public batchRoot;

    // ─────────────────────────────── Events ──────────────────────────────
    event RecordingRegistered(bytes32 indexed isrcKey, address indexed claimant, bytes32 payloadHash, bytes32 claimHash);
    event ClaimUpdated(
        bytes32 indexed isrcKey, uint32 indexed version, bytes32 payloadHash, bytes32 claimHash, address actor, string reason
    );
    event TransferProposed(bytes32 indexed isrcKey, address indexed from, address indexed to, bytes32 transferHash);
    event TransferCancelled(bytes32 indexed isrcKey, address indexed from, address indexed to);
    event TransferAccepted(bytes32 indexed isrcKey, address indexed from, address indexed to);
    event DisputeOpened(bytes32 indexed isrcKey, address indexed opener, bytes32 reasonHash);
    event DisputeResolved(bytes32 indexed isrcKey, address indexed arbiter, address indexed claimant, bytes32 resolutionHash);
    event RecordingSuperseded(bytes32 indexed isrcKey, bytes32 indexed replacementKey, bytes32 reasonHash);
    event DerivativeLinked(bytes32 indexed childKey, bytes32 indexed parentKey, bytes32 derivativeType);
    event ReleaseAnchored(bytes32 indexed upcKey, uint32 indexed version, bytes32 tracklistHash);
    event BatchAnchored(uint256 indexed batchId, bytes32 root, uint256 eventCount, string uri);

    // ─────────────────────────────── Errors ──────────────────────────────
    error AlreadyRegistered(bytes32 isrcKey);
    error NotRegistered(bytes32 isrcKey);
    error NotAuthorized();
    error RecordDisputed(bytes32 isrcKey);
    error RecordNotDisputed(bytes32 isrcKey);
    error RecordSuperseded(bytes32 isrcKey);
    error ZeroValue();
    error LengthMismatch();
    error NoPendingTransfer(bytes32 isrcKey);

    constructor(address admin, address issuer, address arbiter) {
        if (admin == address(0) || issuer == address(0) || arbiter == address(0)) revert ZeroValue();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, issuer);
        _grantRole(ARBITER_ROLE, arbiter);
    }

    // ─────────────────────────────── Registration ────────────────────────
    /// @notice Anchor a newly assigned (or newly claimed) ISRC. Reverts on duplicates:
    ///         the API's dedupe step should catch them first, this is the last line.
    function registerRecording(bytes32 isrcKey, bytes32 payloadHash, bytes32 claimHash, address claimant)
        public
        onlyRole(ISSUER_ROLE)
        whenNotPaused
    {
        _register(isrcKey, payloadHash, claimHash, claimant);
    }

    /// @notice Batch form of registerRecording, for the 5–15 minute anchor window.
    function registerBatch(
        bytes32[] calldata isrcKeys,
        bytes32[] calldata payloadHashes,
        bytes32[] calldata claimHashes,
        address[] calldata claimants
    ) external onlyRole(ISSUER_ROLE) whenNotPaused {
        uint256 n = isrcKeys.length;
        if (payloadHashes.length != n || claimHashes.length != n || claimants.length != n) revert LengthMismatch();
        for (uint256 i; i < n; ++i) {
            _register(isrcKeys[i], payloadHashes[i], claimHashes[i], claimants[i]);
        }
    }

    // ─────────────────────────────── Updates ─────────────────────────────
    /// @notice Append a new version (metadata correction or claim change). Old versions stay verifiable.
    /// @dev Claimant may update unless the record is disputed or superseded.
    ///      Issuer and arbiter may always append (e.g. SoundExchange reconciliation).
    function updateClaim(bytes32 isrcKey, bytes32 payloadHash, bytes32 claimHash, string calldata reason)
        external
        whenNotPaused
    {
        Record storage r = _existing(isrcKey);
        bool privileged = hasRole(ISSUER_ROLE, msg.sender) || hasRole(ARBITER_ROLE, msg.sender);
        if (!privileged) {
            if (msg.sender != r.claimant) revert NotAuthorized();
            if (r.status == Status.Disputed) revert RecordDisputed(isrcKey);
            if (r.status == Status.Superseded) revert RecordSuperseded(isrcKey);
        }
        uint32 v = _appendVersion(isrcKey, payloadHash, claimHash);
        emit ClaimUpdated(isrcKey, v, payloadHash, claimHash, msg.sender, reason);
    }

    // ─────────────────────────────── Transfers ───────────────────────────
    /// @notice Step 1 of a catalog sale or assignment. For splits above your threshold,
    ///         make the claimant a Safe multisig so this call itself needs multiple signatures.
    function proposeTransfer(bytes32 isrcKey, address newClaimant, bytes32 transferHash) external whenNotPaused {
        Record storage r = _existing(isrcKey);
        if (msg.sender != r.claimant) revert NotAuthorized();
        if (r.status != Status.Registered) revert RecordDisputed(isrcKey);
        if (newClaimant == address(0) || transferHash == bytes32(0)) revert ZeroValue();
        r.pendingClaimant = newClaimant;
        emit TransferProposed(isrcKey, msg.sender, newClaimant, transferHash);
    }

    function cancelTransfer(bytes32 isrcKey) external {
        Record storage r = _existing(isrcKey);
        if (msg.sender != r.claimant) revert NotAuthorized();
        address to = r.pendingClaimant;
        if (to == address(0)) revert NoPendingTransfer(isrcKey);
        delete r.pendingClaimant;
        emit TransferCancelled(isrcKey, msg.sender, to);
    }

    /// @notice Step 2: the buyer accepts. Buyer inherits the full version history.
    function acceptTransfer(bytes32 isrcKey) external whenNotPaused {
        Record storage r = _existing(isrcKey);
        if (r.pendingClaimant == address(0)) revert NoPendingTransfer(isrcKey);
        if (msg.sender != r.pendingClaimant) revert NotAuthorized();
        if (r.status != Status.Registered) revert RecordDisputed(isrcKey);
        address from = r.claimant;
        r.claimant = msg.sender;
        delete r.pendingClaimant;
        emit TransferAccepted(isrcKey, from, msg.sender);
    }

    // ─────────────────────────────── Disputes ────────────────────────────
    /// @notice Freeze transfers and claimant edits. History is untouched.
    /// @dev Opened by the backend (relaying a verified user dispute) or an arbiter,
    ///      so random wallets cannot grief records.
    function openDispute(bytes32 isrcKey, bytes32 reasonHash) external whenNotPaused {
        if (!hasRole(ISSUER_ROLE, msg.sender) && !hasRole(ARBITER_ROLE, msg.sender)) revert NotAuthorized();
        Record storage r = _existing(isrcKey);
        if (r.status == Status.Superseded) revert RecordSuperseded(isrcKey);
        if (r.status == Status.Disputed) revert RecordDisputed(isrcKey);
        r.status = Status.Disputed;
        delete r.pendingClaimant;
        emit DisputeOpened(isrcKey, msg.sender, reasonHash);
    }

    /// @notice Close a dispute. Appends the resolved record as a new version.
    ///         The losing claim stays visible in earlier versions and off-chain evidence.
    function resolveDispute(bytes32 isrcKey, bytes32 payloadHash, bytes32 claimHash, address claimant, bytes32 resolutionHash)
        external
        onlyRole(ARBITER_ROLE)
    {
        Record storage r = _existing(isrcKey);
        if (r.status != Status.Disputed) revert RecordNotDisputed(isrcKey);
        if (claimant == address(0)) revert ZeroValue();
        r.claimant = claimant;
        r.status = Status.Registered;
        uint32 v = _appendVersion(isrcKey, payloadHash, claimHash);
        emit ClaimUpdated(isrcKey, v, payloadHash, claimHash, msg.sender, "dispute_resolved");
        emit DisputeResolved(isrcKey, msg.sender, claimant, resolutionHash);
    }

    /// @notice Mark a duplicate ISRC as superseded by the surviving one. Never deletes it.
    function supersede(bytes32 isrcKey, bytes32 replacementKey, bytes32 reasonHash) external onlyRole(ARBITER_ROLE) {
        Record storage r = _existing(isrcKey);
        _existing(replacementKey);
        if (isrcKey == replacementKey) revert ZeroValue();
        r.status = Status.Superseded;
        r.supersededBy = replacementKey;
        delete r.pendingClaimant;
        emit RecordingSuperseded(isrcKey, replacementKey, reasonHash);
    }

    // ─────────────────────────────── Links & releases ────────────────────
    /// @notice Remix / alt version: new ISRC linked to its parent. derivativeType e.g. keccak256("remix").
    function linkDerivative(bytes32 childKey, bytes32 parentKey, bytes32 derivativeType)
        external
        onlyRole(ISSUER_ROLE)
        whenNotPaused
    {
        _existing(childKey);
        _existing(parentKey);
        if (childKey == parentKey) revert ZeroValue();
        emit DerivativeLinked(childKey, parentKey, derivativeType);
    }

    /// @notice Anchor a UPC → ordered ISRC tracklist. Re-releases get a new UPC; ISRCs stay the same.
    function anchorRelease(bytes32 upcKey, bytes32 tracklistHash) external onlyRole(ISSUER_ROLE) whenNotPaused {
        if (upcKey == bytes32(0) || tracklistHash == bytes32(0)) revert ZeroValue();
        uint32 v = releaseVersion[upcKey]++;
        releaseTracklistHash[upcKey] = tracklistHash;
        emit ReleaseAnchored(upcKey, v, tracklistHash);
    }

    /// @notice Anchor a Merkle root of provenance_event hashes from one batch window.
    function anchorBatch(bytes32 root, uint256 eventCount, string calldata uri)
        external
        onlyRole(ISSUER_ROLE)
        whenNotPaused
        returns (uint256 batchId)
    {
        if (root == bytes32(0) || eventCount == 0) revert ZeroValue();
        batchId = batchCount++;
        batchRoot[batchId] = root;
        emit BatchAnchored(batchId, root, eventCount, uri);
    }

    // ─────────────────────────────── Admin ───────────────────────────────
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ─────────────────────────────── Views ───────────────────────────────
    /// @notice Latest state for the public verifier and GET /v1/verify.
    function verify(bytes32 isrcKey)
        external
        view
        returns (
            bytes32 payloadHash,
            bytes32 claimHash,
            uint64 anchoredAt,
            address claimant,
            Status status,
            uint32 versionCount,
            bytes32 supersededBy
        )
    {
        Record storage r = _records[isrcKey];
        if (r.status == Status.None) revert NotRegistered(isrcKey);
        Version storage latest = _versions[isrcKey][r.versionCount - 1];
        return (latest.payloadHash, latest.claimHash, latest.anchoredAt, r.claimant, r.status, r.versionCount, r.supersededBy);
    }

    function getVersion(bytes32 isrcKey, uint256 index) external view returns (Version memory) {
        Record storage r = _records[isrcKey];
        if (r.status == Status.None) revert NotRegistered(isrcKey);
        if (index >= r.versionCount) revert NotRegistered(isrcKey);
        return _versions[isrcKey][index];
    }

    function pendingClaimantOf(bytes32 isrcKey) external view returns (address) {
        return _records[isrcKey].pendingClaimant;
    }

    /// @notice Convenience: compute isrcKey from an already-normalized ISRC string.
    /// @dev Normalize off-chain first (uppercase, strip hyphens and spaces).
    function isrcKeyOf(string calldata normalizedIsrc) external pure returns (bytes32) {
        return keccak256(bytes(normalizedIsrc));
    }

    // ─────────────────────────────── Internals ───────────────────────────
    function _register(bytes32 isrcKey, bytes32 payloadHash, bytes32 claimHash, address claimant) internal {
        if (isrcKey == bytes32(0) || claimant == address(0)) revert ZeroValue();
        Record storage r = _records[isrcKey];
        if (r.status != Status.None) revert AlreadyRegistered(isrcKey);
        r.claimant = claimant;
        r.status = Status.Registered;
        _appendVersion(isrcKey, payloadHash, claimHash);
        emit RecordingRegistered(isrcKey, claimant, payloadHash, claimHash);
    }

    function _appendVersion(bytes32 isrcKey, bytes32 payloadHash, bytes32 claimHash) internal returns (uint32 v) {
        if (payloadHash == bytes32(0)) revert ZeroValue();
        Record storage r = _records[isrcKey];
        v = r.versionCount++;
        _versions[isrcKey][v] =
            Version({payloadHash: payloadHash, claimHash: claimHash, actor: msg.sender, anchoredAt: uint64(block.timestamp)});
    }

    function _existing(bytes32 isrcKey) internal view returns (Record storage r) {
        r = _records[isrcKey];
        if (r.status == Status.None) revert NotRegistered(isrcKey);
    }
}
