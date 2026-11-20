// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ProofStreamRegistry — ISRC-keyed rights-claim provenance
/// @notice Anchors who claimed what, when, and what changed afterwards. It does NOT
///         issue ISRCs: SoundExchange / IFPI-authorized channels remain the authority.
///         Only hashes and codes live here; claims, split sheets, PII and audio stay off-chain.
/// @dev    ISRCs are passed in canonical form: 12 upper-case characters, no dashes
///         ("USSKG2612345"). The API strips dashes before hashing so that the API and
///         the contract always derive the same key.
///         payloadHash = sha256 of the RFC 8785 (JCS) canonical Provenance Record JSON.
///         claimHash   = sha256 of the RFC 8785 canonical rights-claim JSON.
contract ProofStreamRegistry is AccessControl, Pausable {

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

    uint256 public constant MAX_SPLITS = 32;
    uint16 public constant FULL_SHARE = 10_000;

    error InvalidISRC();
    error InvalidUPC();
    error UnknownISRC();
    error AlreadyRegistered();
    error ZeroHash();
    error ZeroAddress();
    error ReasonRequired();
    error NotActive();
    error NotClaimantOrIssuer();
    error NotAllowedToDispute();
    error NoOpenDispute();
    error BadStatusTransition();
    error BadVersion();
    error TooManySplits();
    error BadSplit();
    error SplitsDoNotSumToFull(bytes32 rightType, bytes32 territory, uint256 total);

    /// @dev None is the zero value, so verify() on an unknown ISRC is unambiguous.
    enum Status { None, Active, Disputed, Frozen, Superseded, Revoked }

    /// @dev Fixed-size fields keep storage and calldata cheap. rightType and territory
    ///      are short codes such as "master" / "publishing" and "WW" / "US".
    struct Split {
        bytes32 beneficiaryHash; // hash of off-chain identity (IPI, account id) — never a name
        uint16 basisPoints;      // 10_000 = 100%
        bytes32 rightType;
        bytes32 territory;
    }

    struct Version {
        bytes32 payloadHash;
        bytes32 claimHash;
        bytes32 splitsHash;      // keccak256(abi.encode(splits)); full splits are in the event
        bytes32 reason;          // code: "initial", "split_correction", "metadata_fix", ...
        address submittedBy;
        uint64 timestamp;
        uint64 blockNumber;
    }

    struct Recording {
        bytes32 parentIsrcHash;  // remix / alt version link, zero if original
        address claimant;        // current rights holder of record
        Status status;
        uint64 createdAt;
        uint64 updatedAt;
        uint32 currentVersion;
    }

    struct UPCLink {
        bytes32 upcHash;
        uint64 timestamp;
    }

    mapping(bytes32 => Recording) private _recordings;
    mapping(bytes32 => Version[]) private _versions;     // append-only
    mapping(bytes32 => UPCLink[]) private _upcs;          // append-only: re-releases add, never replace

    event RecordingRegistered(bytes32 indexed isrcHash, string isrc, address indexed claimant, bytes32 parentIsrcHash, bytes32 payloadHash, bytes32 claimHash, Split[] splits);
    event ClaimUpdated(bytes32 indexed isrcHash, uint256 indexed version, bytes32 payloadHash, bytes32 claimHash, bytes32 reason, Split[] splits);
    event UPCLinked(bytes32 indexed isrcHash, string upc, bytes32 upcHash);
    event RightsTransferred(bytes32 indexed isrcHash, address indexed from, address indexed to, bytes32 transferHash);
    event DisputeOpened(bytes32 indexed isrcHash, address indexed openedBy, bytes32 reason, bytes32 evidenceHash);
    event DisputeResolved(bytes32 indexed isrcHash, address indexed resolvedBy, bytes32 outcome, Status newStatus);
    event StatusChanged(bytes32 indexed isrcHash, Status oldStatus, Status newStatus, bytes32 reason);

    /// @param admin Should be a multisig (2-of-3 minimum). It receives every role; hand
    ///              ISSUER_ROLE to the API's signer and revoke it from the admin afterwards.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        _grantRole(ARBITER_ROLE, admin);
    }

    // ---- Register ----

    /// @notice Register a recording after its ISRC was assigned through an authorized channel.
    /// @param claimant The rights holder of record: an account address the platform holds
    ///                 for the creator (custodial) or the creator's own wallet.
    function registerRecording(
        string calldata isrc,
        address claimant,
        bytes32 payloadHash,
        bytes32 claimHash,
        Split[] calldata splits,
        string calldata parentIsrc
    ) external onlyRole(ISSUER_ROLE) whenNotPaused returns (bytes32 isrcHash) {
        isrcHash = _hashValidISRC(isrc);
        if (_recordings[isrcHash].status != Status.None) revert AlreadyRegistered();
        if (claimant == address(0)) revert ZeroAddress();
        bytes32 parentHash = bytes(parentIsrc).length == 0 ? bytes32(0) : _hashValidISRC(parentIsrc);
        if (parentHash == isrcHash) revert InvalidISRC();

        _recordings[isrcHash] = Recording({
            parentIsrcHash: parentHash,
            claimant: claimant,
            status: Status.Active,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            currentVersion: 0
        });
        _pushVersion(isrcHash, payloadHash, claimHash, splits, "initial");
        emit RecordingRegistered(isrcHash, isrc, claimant, parentHash, payloadHash, claimHash, splits);
    }

    // ---- Update claim (append-only) ----

    function updateClaim(
        string calldata isrc,
        bytes32 payloadHash,
        bytes32 claimHash,
        Split[] calldata splits,
        bytes32 reason
    ) external whenNotPaused {
        bytes32 isrcHash = _hashISRC(isrc);
        Recording storage r = _activeRecording(isrcHash);
        _requireClaimantOrIssuer(r);
        if (reason == bytes32(0)) revert ReasonRequired();
        uint256 version = _pushVersion(isrcHash, payloadHash, claimHash, splits, reason);
        r.currentVersion = uint32(version);
        r.updatedAt = uint64(block.timestamp);
        emit ClaimUpdated(isrcHash, version, payloadHash, claimHash, reason, splits);
    }

    // ---- UPC bundling (append-only) ----

    function linkUPC(string calldata isrc, string calldata upc) external onlyRole(ISSUER_ROLE) whenNotPaused {
        bytes32 isrcHash = _hashISRC(isrc);
        Recording storage r = _activeRecording(isrcHash);
        _requireValidUPC(upc);
        bytes32 upcHash = keccak256(bytes(upc));
        _upcs[isrcHash].push(UPCLink({ upcHash: upcHash, timestamp: uint64(block.timestamp) }));
        r.updatedAt = uint64(block.timestamp);
        emit UPCLinked(isrcHash, upc, upcHash);
    }

    // ---- Transfer ----

    /// @notice Record a catalog sale or assignment. The issuer may act for custodial claimants.
    function transferRights(string calldata isrc, address newClaimant, bytes32 transferHash) external whenNotPaused {
        bytes32 isrcHash = _hashISRC(isrc);
        Recording storage r = _activeRecording(isrcHash);
        _requireClaimantOrIssuer(r);
        if (newClaimant == address(0)) revert ZeroAddress();
        if (transferHash == bytes32(0)) revert ZeroHash();
        address old = r.claimant;
        r.claimant = newClaimant;
        r.updatedAt = uint64(block.timestamp);
        emit RightsTransferred(isrcHash, old, newClaimant, transferHash);
    }

    // ---- Disputes ----

    /// @notice Freezes transfers and claim updates. Restricted so that strangers cannot
    ///         lock any recording for free: the claimant, issuer, arbiter, or an approved
    ///         reporter (e.g. a vetted label or distributor) may open one.
    function openDispute(string calldata isrc, bytes32 reason, bytes32 evidenceHash) external whenNotPaused {
        bytes32 isrcHash = _hashISRC(isrc);
        Recording storage r = _activeRecording(isrcHash);
        if (
            msg.sender != r.claimant &&
            !hasRole(ISSUER_ROLE, msg.sender) &&
            !hasRole(ARBITER_ROLE, msg.sender) &&
            !hasRole(REPORTER_ROLE, msg.sender)
        ) revert NotAllowedToDispute();
        if (reason == bytes32(0)) revert ReasonRequired();
        _setStatus(isrcHash, r, Status.Disputed, reason);
        emit DisputeOpened(isrcHash, msg.sender, reason, evidenceHash);
    }

    /// @param newStatus Active (claim upheld or adjusted) or Revoked (claim invalid).
    function resolveDispute(string calldata isrc, bytes32 outcome, Status newStatus) external onlyRole(ARBITER_ROLE) {
        bytes32 isrcHash = _hashISRC(isrc);
        Recording storage r = _existing(isrcHash);
        if (r.status != Status.Disputed) revert NoOpenDispute();
        if (outcome == bytes32(0)) revert ReasonRequired();
        if (newStatus != Status.Active && newStatus != Status.Revoked) revert BadStatusTransition();
        _setStatus(isrcHash, r, newStatus, outcome);
        emit DisputeResolved(isrcHash, msg.sender, outcome, newStatus);
    }

    /// @notice Arbiter holds and terminal states. Allowed moves:
    ///         Active -> Frozen | Superseded | Revoked, Frozen -> Active | Revoked.
    ///         Disputes go through resolveDispute; Superseded and Revoked are final.
    function setStatus(string calldata isrc, Status newStatus, bytes32 reason) external onlyRole(ARBITER_ROLE) {
        bytes32 isrcHash = _hashISRC(isrc);
        Recording storage r = _existing(isrcHash);
        if (reason == bytes32(0)) revert ReasonRequired();
        Status old = r.status;
        bool allowed =
            (old == Status.Active && (newStatus == Status.Frozen || newStatus == Status.Superseded || newStatus == Status.Revoked)) ||
            (old == Status.Frozen && (newStatus == Status.Active || newStatus == Status.Revoked));
        if (!allowed) revert BadStatusTransition();
        _setStatus(isrcHash, r, newStatus, reason);
    }

    // ---- Reads ----

    /// @notice Public verification for DSPs, labels, sync buyers and distributors.
    ///         found = false for an unknown ISRC. Compare payloadHash with
    ///         sha256(canonical JSON) off-chain.
    function verify(string calldata isrc) external view returns (
        bool found,
        Status status,
        bytes32 payloadHash,
        bytes32 claimHash,
        address claimant,
        uint64 anchoredAt,
        uint256 version,
        uint256 blockNumber
    ) {
        bytes32 isrcHash = _hashISRC(isrc);
        Recording storage r = _recordings[isrcHash];
        if (r.status == Status.None) return (false, Status.None, 0, 0, address(0), 0, 0, 0);
        Version storage v = _versions[isrcHash][r.currentVersion];
        return (true, r.status, v.payloadHash, v.claimHash, r.claimant, v.timestamp, r.currentVersion, v.blockNumber);
    }

    function getRecording(string calldata isrc) external view returns (Recording memory) {
        return _existing(_hashISRC(isrc));
    }

    function getVersion(string calldata isrc, uint256 index) external view returns (Version memory) {
        bytes32 isrcHash = _hashISRC(isrc);
        _existing(isrcHash);
        if (index >= _versions[isrcHash].length) revert BadVersion();
        return _versions[isrcHash][index];
    }

    function versionCount(string calldata isrc) external view returns (uint256) {
        return _versions[_hashISRC(isrc)].length;
    }

    function getUPCs(string calldata isrc) external view returns (UPCLink[] memory) {
        return _upcs[_hashISRC(isrc)];
    }

    /// @notice Checks a split list against the hash anchored for a version.
    function splitsMatch(string calldata isrc, uint256 index, Split[] calldata splits) external view returns (bool) {
        bytes32 isrcHash = _hashISRC(isrc);
        if (index >= _versions[isrcHash].length) revert BadVersion();
        return _versions[isrcHash][index].splitsHash == keccak256(abi.encode(splits));
    }

    function isrcHashOf(string calldata isrc) external pure returns (bytes32) {
        return _hashValidISRC(isrc);
    }

    // ---- Admin ----

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ---- Internals ----

    function _pushVersion(
        bytes32 isrcHash,
        bytes32 payloadHash,
        bytes32 claimHash,
        Split[] calldata splits,
        bytes32 reason
    ) internal returns (uint256 index) {
        if (payloadHash == bytes32(0) || claimHash == bytes32(0)) revert ZeroHash();
        _validateSplits(splits);
        index = _versions[isrcHash].length;
        _versions[isrcHash].push(Version({
            payloadHash: payloadHash,
            claimHash: claimHash,
            splitsHash: keccak256(abi.encode(splits)),
            reason: reason,
            submittedBy: msg.sender,
            timestamp: uint64(block.timestamp),
            blockNumber: uint64(block.number)
        }));
    }

    /// @dev Each (rightType, territory) group must sum to exactly 100%, so one recording
    ///      can carry master and publishing splits side by side. An empty list is allowed
    ///      (splits not yet known); claimHash still anchors the claim.
    function _validateSplits(Split[] calldata splits) internal pure {
        uint256 n = splits.length;
        if (n > MAX_SPLITS) revert TooManySplits();
        for (uint256 i = 0; i < n; i++) {
            Split calldata s = splits[i];
            if (s.basisPoints == 0 || s.basisPoints > FULL_SHARE) revert BadSplit();
            if (s.rightType == bytes32(0) || s.territory == bytes32(0) || s.beneficiaryHash == bytes32(0)) revert BadSplit();
            // Sum each group once, at its first member.
            bool firstOfGroup = true;
            for (uint256 j = 0; j < i; j++) {
                if (splits[j].rightType == s.rightType && splits[j].territory == s.territory) { firstOfGroup = false; break; }
            }
            if (!firstOfGroup) continue;
            uint256 total = s.basisPoints;
            for (uint256 j = i + 1; j < n; j++) {
                if (splits[j].rightType == s.rightType && splits[j].territory == s.territory) total += splits[j].basisPoints;
            }
            if (total != FULL_SHARE) revert SplitsDoNotSumToFull(s.rightType, s.territory, total);
        }
    }

    function _setStatus(bytes32 isrcHash, Recording storage r, Status newStatus, bytes32 reason) internal {
        Status old = r.status;
        r.status = newStatus;
        r.updatedAt = uint64(block.timestamp);
        emit StatusChanged(isrcHash, old, newStatus, reason);
    }

    function _requireClaimantOrIssuer(Recording storage r) internal view {
        if (msg.sender != r.claimant && !hasRole(ISSUER_ROLE, msg.sender)) revert NotClaimantOrIssuer();
    }

    function _existing(bytes32 isrcHash) internal view returns (Recording storage r) {
        r = _recordings[isrcHash];
        if (r.status == Status.None) revert UnknownISRC();
    }

    function _activeRecording(bytes32 isrcHash) internal view returns (Recording storage r) {
        r = _existing(isrcHash);
        if (r.status != Status.Active) revert NotActive();
    }

    /// @dev Lookups hash without validating, so a malformed ISRC simply is not found.
    function _hashISRC(string calldata isrc) internal pure returns (bytes32) {
        return keccak256(bytes(isrc));
    }

    /// @dev ISO 3901 canonical form: CC (letters) + XXX (registrant, A-Z0-9) + YY (digits) + NNNNN (digits).
    function _hashValidISRC(string calldata isrc) internal pure returns (bytes32) {
        bytes calldata b = bytes(isrc);
        if (b.length != 12) revert InvalidISRC();
        for (uint256 i = 0; i < 12; i++) {
            bytes1 c = b[i];
            bool upper = c >= 0x41 && c <= 0x5A;
            bool digit = c >= 0x30 && c <= 0x39;
            if (i < 2 ? !upper : (i < 5 ? !(upper || digit) : !digit)) revert InvalidISRC();
        }
        return keccak256(b);
    }

    /// @dev UPC-A (12) or EAN-13 (13) digits with a valid GS1 check digit.
    function _requireValidUPC(string calldata upc) internal pure {
        bytes calldata b = bytes(upc);
        uint256 n = b.length;
        if (n != 12 && n != 13) revert InvalidUPC();
        uint256 sum = 0;
        for (uint256 i = 0; i < n; i++) {
            if (b[i] < 0x30 || b[i] > 0x39) revert InvalidUPC();
            if (i == n - 1) break;
            uint256 d = uint8(b[i]) - 48;
            // Weights alternate 3,1,... counting from the digit next to the check digit.
            sum += ((n - 1 - i) % 2 == 1) ? d * 3 : d;
        }
        uint256 check = (10 - (sum % 10)) % 10;
        if (uint8(b[n - 1]) - 48 != check) revert InvalidUPC();
    }
}
