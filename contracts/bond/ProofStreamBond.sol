// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import "@solvprotocol/erc-3525/ERC3525.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Compliance3525Hook.sol";
import "./QIBTransferPolicy.sol";

/// @notice Testnet bond ledger. Units are hundredths of the series currency.
/// No cash settlement, interest calculation or legal rights are created by this code alone.
contract ProofStreamBond is ERC3525, Compliance3525Hook, ReentrancyGuard {
    struct Series {
        bytes32 termsHash;
        bytes3 currency;
        uint64 maturity;
        uint256 issuanceCap;
        uint256 issued;
        uint256 outstanding;
    }
    address public immutable governance;
    mapping(address => bool) public issuers;
    mapping(address => bool) public trustees;
    mapping(uint256 => Series) public series;
    mapping(bytes32 => bool) public usedReferences;
    mapping(uint256 => uint256) public valueApprovalCount;
    // Only active during a trustee transfer that performs no external callbacks.
    bool private recovering;
    event RoleUpdated(address indexed account, bool issuer, bool trustee);
    event SeriesCreated(uint256 indexed slot, bytes32 termsHash, bytes3 currency, uint64 maturity, uint256 cap);
    event Issued(uint256 indexed tokenId, uint256 indexed slot, uint256 value, bytes32 referenceHash);
    event RedemptionRecorded(uint256 indexed tokenId, uint256 value, bytes32 settlementReference);
    event Recovered(uint256 indexed tokenId, address indexed previousOwner, address indexed newOwner, bytes32 orderHash);

    constructor(address admin, address issuer, address trustee, address policy)
        ERC3525("ProofStream Institutional Bond", "PSB", 2) Compliance3525Hook(policy) {
        require(admin != address(0) && issuer != address(0) && trustee != address(0), "Zero role");
        governance = admin;
        issuers[issuer] = true;
        trustees[trustee] = true;
        emit RoleUpdated(issuer, true, false);
        emit RoleUpdated(trustee, issuers[trustee], true);
    }
    modifier onlyIssuer() { require(issuers[msg.sender], "Not issuer"); _; }
    modifier onlyTrustee() { require(trustees[msg.sender], "Not trustee"); _; }
    function setRoles(address account, bool issuer, bool trustee) external {
        require(msg.sender == governance, "Not governance");
        require(account != address(0), "Zero role");
        issuers[account] = issuer; trustees[account] = trustee;
        emit RoleUpdated(account, issuer, trustee);
    }
    function createSeries(uint256 slot, bytes32 termsHash, bytes3 currency, uint64 maturity, uint256 cap) external onlyIssuer {
        require(slot != 0 && series[slot].termsHash == bytes32(0), "Invalid slot");
        require(termsHash != bytes32(0) && maturity > block.timestamp && cap > 0, "Invalid terms");
        for (uint256 i; i < 3; ++i) require(currency[i] >= 0x41 && currency[i] <= 0x5a, "Invalid currency");
        series[slot] = Series(termsHash, currency, maturity, cap, 0, 0);
        emit SeriesCreated(slot, termsHash, currency, maturity, cap);
    }
    function _consumeReference(bytes32 referenceHash) private {
        require(referenceHash != bytes32(0) && !usedReferences[referenceHash], "Invalid reference");
        usedReferences[referenceHash] = true;
    }
    function issue(address to, uint256 slot, uint256 value, bytes32 referenceHash) external onlyIssuer nonReentrant returns (uint256 tokenId) {
        Series storage s = series[slot];
        require(s.termsHash != bytes32(0) && block.timestamp < s.maturity && value > 0, "Invalid issuance");
        require(s.issued + value <= s.issuanceCap, "Issuance cap");
        _consumeReference(referenceHash);
        s.issued += value; s.outstanding += value;
        tokenId = _mint(to, slot, value);
        emit Issued(tokenId, slot, value, referenceHash);
    }
    /// @dev Trustee confirms settlement externally. This function does NOT send funds.
    function recordRedemption(uint256 tokenId, uint256 value, bytes32 settlementReference) external onlyTrustee nonReentrant {
        require(value > 0 && value <= balanceOf(tokenId), "Invalid redemption");
        _consumeReference(settlementReference);
        series[slotOf(tokenId)].outstanding -= value;
        if (value == balanceOf(tokenId)) _burn(tokenId); else _burnValue(tokenId, value);
        emit RedemptionRecorded(tokenId, value, settlementReference);
    }
    /// @dev Source eligibility may be bypassed, destination eligibility and pause never are.
    /// Non-safe transfer deliberately avoids receiver callbacks during the exception.
    function recover(uint256 tokenId, address to, bytes32 orderHash) external onlyTrustee nonReentrant {
        address from = ownerOf(tokenId);
        require(from != to && to != address(0), "Invalid recovery");
        _consumeReference(orderHash);
        recovering = true;
        _transferTokenId(from, to, tokenId);
        recovering = false;
        emit Recovered(tokenId, from, to, orderHash);
    }
    function _beforeValueTransfer(address from, address to, uint256 fromId, uint256 toId, uint256 slot, uint256 value) internal override {
        super._beforeValueTransfer(from, to, fromId, toId, slot, value);
        if (recovering) {
            require(!QIBTransferPolicy(address(transferPolicy)).paused()
                && QIBTransferPolicy(address(transferPolicy)).eligible(to), "Recovery not permitted");
        } else _checkBondTransfer(from, to, slot, value);
    }
    // Bound the upstream approval-clearing loop so recovery cannot be gas-exhausted
    // by an unlimited number of historical value-approval addresses.
    function _approveValue(uint256 id, address operator, uint256 value) internal override {
        if (!_existApproveValue(operator, id)) {
            require(valueApprovalCount[id] < 64, "Too many value approvals");
            valueApprovalCount[id]++;
        }
        super._approveValue(id, operator, value);
    }
    function _clearApprovedValues(uint256 id) internal override {
        super._clearApprovedValues(id);
        valueApprovalCount[id] = 0;
    }
    function _spendAllowance(address operator, uint256 id, uint256 value) internal override {
        // Upstream permits strangers to spend zero, growing approval arrays for free.
        require(_isApprovedOrOwner(operator, id) || allowance(id, operator) > 0, "Not authorized");
        super._spendAllowance(operator, id, value);
    }
    // Guard every transfer entry point against receiver callbacks and accidental ETH.
    function transferFrom(uint256 from, uint256 to, uint256 value) public payable override nonReentrant {
        require(msg.value == 0, "No ETH"); super.transferFrom(from, to, value);
    }
    function transferFrom(uint256 from, address to, uint256 value) public payable override nonReentrant returns (uint256) {
        require(msg.value == 0, "No ETH"); return super.transferFrom(from, to, value);
    }
    function transferFrom(address from, address to, uint256 id) public payable override nonReentrant {
        require(msg.value == 0, "No ETH"); super.transferFrom(from, to, id);
    }
    function safeTransferFrom(address from, address to, uint256 id, bytes memory data) public payable override nonReentrant {
        require(msg.value == 0, "No ETH"); super.safeTransferFrom(from, to, id, data);
    }
    // The inherited three-argument safe transfer dispatches to the guarded overload above.
    function approve(address to, uint256 id) public payable override {
        require(msg.value == 0, "No ETH"); super.approve(to, id);
    }
    function approve(uint256 id, address to, uint256 value) public payable override {
        require(msg.value == 0, "No ETH"); super.approve(id, to, value);
    }
}
