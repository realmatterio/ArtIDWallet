// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ArtIDTransferMandates is ReentrancyGuard {
    uint256 public constant MAX_ARTWORKS_PER_MANDATE = 100;
    uint256 public nextMandateId = 1;

    struct Mandate {
        address principal;
        address recipient;
        uint64 expiresAt;
        uint256 remainingTransfers;
        bool revoked;
    }

    mapping(uint256 => Mandate) public mandates;
    mapping(uint256 => mapping(address => bool)) public permittedArtwork;

    event MandateCreated(
        uint256 indexed mandateId,
        address indexed principal,
        address indexed recipient,
        uint64 expiresAt,
        uint256 maxTransfers,
        address[] artworks
    );
    event MandateRevoked(uint256 indexed mandateId, address indexed principal);
    event MandateTransfer(
        uint256 indexed mandateId,
        address indexed artwork,
        address indexed recipient,
        uint256 remainingTransfers
    );

    function createMandate(
        address recipient,
        address[] calldata artworks,
        uint64 expiresAt,
        uint256 maxTransfers
    ) external returns (uint256 mandateId) {
        require(recipient != address(0) && recipient != msg.sender, "Invalid recipient");
        require(expiresAt > block.timestamp, "Expiry must be in the future");
        require(maxTransfers > 0, "Invalid transfer limit");
        require(artworks.length > 0 && artworks.length <= MAX_ARTWORKS_PER_MANDATE, "Invalid artwork count");

        mandateId = nextMandateId++;
        mandates[mandateId] = Mandate(msg.sender, recipient, expiresAt, maxTransfers, false);
        for (uint256 i = 0; i < artworks.length; ++i) {
            address artwork = artworks[i];
            require(artwork.code.length > 0, "Artwork must be a contract");
            require(!permittedArtwork[mandateId][artwork], "Duplicate artwork");
            permittedArtwork[mandateId][artwork] = true;
        }
        emit MandateCreated(mandateId, msg.sender, recipient, expiresAt, maxTransfers, artworks);
    }

    function revokeMandate(uint256 mandateId) external {
        Mandate storage mandate = mandates[mandateId];
        require(mandate.principal == msg.sender, "Only principal");
        require(!mandate.revoked, "Already revoked");
        mandate.revoked = true;
        emit MandateRevoked(mandateId, msg.sender);
    }

    function executeTransfer(uint256 mandateId, address artwork) external nonReentrant {
        Mandate storage mandate = mandates[mandateId];
        require(mandate.principal == msg.sender, "Only principal");
        require(!mandate.revoked, "Mandate revoked");
        require(block.timestamp < mandate.expiresAt, "Mandate expired");
        require(mandate.remainingTransfers > 0, "Transfer limit reached");
        require(permittedArtwork[mandateId][artwork], "Artwork not permitted");

        mandate.remainingTransfers -= 1;
        IERC721(artwork).safeTransferFrom(mandate.principal, mandate.recipient, 1);
        emit MandateTransfer(mandateId, artwork, mandate.recipient, mandate.remainingTransfers);
    }
}
