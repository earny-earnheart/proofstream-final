// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ProofStream — on-chain IP timestamping with creator-bound registrations
/// @notice Front-running mitigation: every registration is keyed on
///         keccak256(creator, contentHash), so two different creators can
///         independently register the same contentHash without colliding.
///         A copier can no longer claim Alice's contentHash by paying higher gas.
contract ProofStream is Ownable, ReentrancyGuard, Pausable {

    error InsufficientFee();
    error ProjectAlreadyExists();
    error NotProjectOwner();
    error ContentAlreadyRegistered();
    error ContentNotRegistered();
    error InvalidAddress();
    error AlreadyDesignated();
    error NotDesignatedWitness();
    error AlreadyAttested();
    error NoFunds();
    error WithdrawalFailed();
    error InvalidProjectId();
    error InvalidContentHash();

    struct Milestone {
        bytes32 contentHash;
        uint64 timestamp;
        bool isEncrypted;
        string title;
        string stage;
        string ipfsHash;
        address[] witnesses;
    }

    struct Project {
        address creator;
        uint64 createdAt;
        bool isPublic;
        string projectId;
        string category;
        Milestone[] milestones;
    }

    mapping(bytes32 => Project) public projects;
    mapping(address => bytes32[]) public creatorProjects;

    struct RegistrationInfo {
        bytes32 projectHash;
        address creator;
        uint32 milestoneIndex;
        uint64 timestamp;
    }

    /// @dev keyed on regKey = keccak256(creator, contentHash), not on contentHash alone.
    mapping(bytes32 => RegistrationInfo) public registrations;

    uint256 public registrationFee = 0.001 ether;
    uint256 public witnessAttestationFee = 0.001 ether;
    uint256 public totalProjects;
    uint256 public totalMilestones;

    /// @dev keyed on regKey, not contentHash.
    mapping(bytes32 => mapping(address => bool)) public designatedWitnesses;
    mapping(bytes32 => mapping(address => uint256)) public witnessAttestations;

    event ProjectCreated(
        bytes32 indexed projectHash,
        address indexed creator,
        string projectId,
        uint256 timestamp
    );

    event MilestoneRegistered(
        bytes32 indexed projectHash,
        bytes32 indexed contentHash,
        address indexed creator,
        uint256 milestoneIndex,
        uint256 timestamp
    );

    event WitnessAdded(
        bytes32 indexed contentHash,
        address indexed witness,
        address indexed creator
    );

    event WitnessAttested(
        bytes32 indexed contentHash,
        address indexed creator,
        address indexed witness,
        uint256 timestamp
    );

    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event WitnessAttestationFeeUpdated(uint256 oldFee, uint256 newFee);
    event Withdrawal(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @dev Creator-bound registration key. The same contentHash registered by
    ///      two different creators produces two distinct regKeys, so neither
    ///      registration blocks the other.
    function _regKey(address creator, bytes32 contentHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(creator, contentHash));
    }

    function createProject(
        string calldata projectId,
        string calldata category,
        bool isPublic
    ) external payable whenNotPaused returns (bytes32) {
        if (bytes(projectId).length == 0) revert InvalidProjectId();
        if (msg.value < registrationFee) revert InsufficientFee();

        bytes32 projectHash = keccak256(
            abi.encodePacked(msg.sender, projectId, block.timestamp)
        );

        Project storage newProject = projects[projectHash];
        if (newProject.creator != address(0)) revert ProjectAlreadyExists();

        newProject.creator = msg.sender;
        newProject.createdAt = uint64(block.timestamp);
        newProject.isPublic = isPublic;
        newProject.projectId = projectId;
        newProject.category = category;

        creatorProjects[msg.sender].push(projectHash);
        unchecked {
            totalProjects++;
        }

        emit ProjectCreated(projectHash, msg.sender, projectId, block.timestamp);

        return projectHash;
    }

    function registerMilestone(
        bytes32 projectHash,
        bytes32 contentHash,
        string calldata title,
        string calldata stage,
        string calldata ipfsHash,
        bool isEncrypted
    ) external payable whenNotPaused {
        if (msg.value < registrationFee) revert InsufficientFee();
        
        Project storage project = projects[projectHash];
        if (project.creator != msg.sender) revert NotProjectOwner();
        if (contentHash == bytes32(0)) revert InvalidContentHash();

        bytes32 regKey = _regKey(msg.sender, contentHash);
        if (registrations[regKey].creator != address(0)) revert ContentAlreadyRegistered();

        project.milestones.push(Milestone({
            contentHash: contentHash,
            timestamp: uint64(block.timestamp),
            isEncrypted: isEncrypted,
            title: title,
            stage: stage,
            ipfsHash: ipfsHash,
            witnesses: new address[](0)
        }));
        
        uint32 milestoneIndex = uint32(project.milestones.length - 1);

        registrations[regKey] = RegistrationInfo({
            projectHash: projectHash,
            creator: msg.sender,
            milestoneIndex: milestoneIndex,
            timestamp: uint64(block.timestamp)
        });

        unchecked {
            totalMilestones++;
        }

        emit MilestoneRegistered(projectHash, contentHash, msg.sender, milestoneIndex, block.timestamp);
    }

    /// @notice Verify whether a specific creator registered a contentHash, and when.
    /// @dev With creator-bound keying, "did anyone register this hash?" is no longer
    ///      a meaningful on-chain question — off-chain indexers should walk
    ///      MilestoneRegistered events to answer that.
    function verifyContent(address creator, bytes32 contentHash)
        external
        view
        returns (bool exists, uint256 timestamp)
    {
        RegistrationInfo memory info = registrations[_regKey(creator, contentHash)];
        return (info.creator != address(0), info.timestamp);
    }

    function addWitness(bytes32 contentHash, address witness) external whenNotPaused {
        bytes32 regKey = _regKey(msg.sender, contentHash);
        if (registrations[regKey].creator == address(0)) revert ContentNotRegistered();
        if (witness == address(0)) revert InvalidAddress();
        if (designatedWitnesses[regKey][witness]) revert AlreadyDesignated();

        designatedWitnesses[regKey][witness] = true;

        emit WitnessAdded(contentHash, witness, msg.sender);
    }

    function attestWitness(address creator, bytes32 contentHash)
        external
        payable
        whenNotPaused
        nonReentrant
    {
        if (msg.value < witnessAttestationFee) revert InsufficientFee();

        bytes32 regKey = _regKey(creator, contentHash);
        RegistrationInfo memory info = registrations[regKey];
        if (info.creator == address(0)) revert ContentNotRegistered();
        if (!designatedWitnesses[regKey][msg.sender]) revert NotDesignatedWitness();
        if (witnessAttestations[regKey][msg.sender] != 0) revert AlreadyAttested();

        witnessAttestations[regKey][msg.sender] = block.timestamp;

        Project storage project = projects[info.projectHash];
        project.milestones[info.milestoneIndex].witnesses.push(msg.sender);

        emit WitnessAttested(contentHash, creator, msg.sender, block.timestamp);
    }

    function getWitnesses(address creator, bytes32 contentHash)
        external
        view
        returns (address[] memory)
    {
        bytes32 regKey = _regKey(creator, contentHash);
        RegistrationInfo memory info = registrations[regKey];
        if (info.creator == address(0)) revert ContentNotRegistered();
        return projects[info.projectHash].milestones[info.milestoneIndex].witnesses;
    }

    function verifyWitness(address creator, bytes32 contentHash, address witness)
        external
        view
        returns (bool attested, uint256 attestedAt)
    {
        uint256 ts = witnessAttestations[_regKey(creator, contentHash)][witness];
        return (ts > 0, ts);
    }

    /// @notice Ergonomic wrapper over the regKey-keyed designatedWitnesses mapping.
    function isDesignatedWitness(address creator, bytes32 contentHash, address witness)
        external
        view
        returns (bool)
    {
        return designatedWitnesses[_regKey(creator, contentHash)][witness];
    }

    function getCreatorProjects(address creator)
        external
        view
        returns (bytes32[] memory)
    {
        return creatorProjects[creator];
    }

    function getProject(bytes32 projectHash)
        external
        view
        returns (
            string memory projectId,
            address creator,
            uint256 createdAt,
            uint256 milestoneCount,
            bool isPublic,
            string memory category
        )
    {
        Project storage project = projects[projectHash];
        return (
            project.projectId,
            project.creator,
            project.createdAt,
            project.milestones.length,
            project.isPublic,
            project.category
        );
    }


    /// @notice Update the registration fee (owner only).
    function setRegistrationFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = registrationFee;
        registrationFee = newFee;
        emit RegistrationFeeUpdated(oldFee, newFee);
    }

    /// @notice Update the witness attestation fee (owner only).
    function setWitnessAttestationFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = witnessAttestationFee;
        witnessAttestationFee = newFee;
        emit WitnessAttestationFeeUpdated(oldFee, newFee);
    }

    /// @notice Pause all state-mutating user operations.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume operations after a pause.
    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoFunds();

        (bool success, ) = payable(owner()).call{value: balance}("");
        if (!success) revert WithdrawalFailed();

        emit Withdrawal(owner(), balance);
    }

    receive() external payable {}
}
