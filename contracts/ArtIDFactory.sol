// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./ArtIDArtwork.sol";

interface IArtIDCollectorRegistry {
    function isRegistered(address account) external view returns (bool);
    function isListed(address account) external view returns (bool);
}

contract ArtIDFactory {
    IArtIDCollectorRegistry public immutable collectorRegistry;
    address[] private artworkContracts;
    mapping(bytes32 => bool) private usedArtworkIds;

    event ArtworkCreated(
        address indexed artworkContract,
        address indexed creator,
        uint256 indexed tokenId,
        string artworkId,
        string did
    );

    constructor(address collectorRegistryAddress) {
        require(collectorRegistryAddress != address(0), "Invalid collector registry");
        collectorRegistry = IArtIDCollectorRegistry(collectorRegistryAddress);
    }

    function createArtwork(
        string calldata artworkId,
        string calldata title,
        string calldata artist,
        string calldata imageURI,
        string calldata contentHash
    ) external returns (address artworkAddress) {
        require(bytes(artworkId).length != 0, "Artwork ID required");
        require(bytes(title).length != 0, "Title required");
        require(collectorRegistry.isRegistered(msg.sender), "Collector not registered");
        require(collectorRegistry.isListed(msg.sender), "Collector is unlisted");
        bytes32 idHash = keccak256(bytes(artworkId));
        require(!usedArtworkIds[idHash], "Artwork ID already used");
        usedArtworkIds[idHash] = true;

        ArtIDArtwork artwork = new ArtIDArtwork(
            address(collectorRegistry),
            msg.sender,
            artworkId,
            title,
            artist,
            imageURI,
            contentHash
        );
        artworkAddress = address(artwork);
        artworkContracts.push(artworkAddress);
        emit ArtworkCreated(
            artworkAddress,
            msg.sender,
            1,
            artworkId,
            artwork.artworkDid()
        );
    }

    function artworkCount() external view returns (uint256) {
        return artworkContracts.length;
    }

    function artworkAt(uint256 index) external view returns (address) {
        return artworkContracts[index];
    }
}
