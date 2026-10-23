// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IArtIDCollectorStatus {
    function isRegistered(address account) external view returns (bool);
    function isListed(address account) external view returns (bool);
}

contract ArtIDArtwork is ERC721 {
    struct ArtworkMetadata {
        string artworkId;
        string title;
        string artist;
        string imageURI;
        string contentHash;
        address creator;
    }

    ArtworkMetadata private artwork;
    IArtIDCollectorStatus public immutable collectorRegistry;
    bool public isListed = true;

    event ArtworkListingUpdated(address indexed artworkContract, bool listed, address indexed changedBy);

    constructor(
        address collectorRegistryAddress,
        address creator,
        string memory artworkId,
        string memory title,
        string memory artist,
        string memory imageURI,
        string memory contentHash
    ) ERC721(title, artworkId) {
        require(creator != address(0), "Invalid creator");
        require(collectorRegistryAddress != address(0), "Invalid collector registry");
        collectorRegistry = IArtIDCollectorStatus(collectorRegistryAddress);
        require(collectorRegistry.isRegistered(creator), "Creator is not a registered collector");
        require(collectorRegistry.isListed(creator), "Creator is unlisted");
        artwork = ArtworkMetadata({
            artworkId: artworkId,
            title: title,
            artist: artist,
            imageURI: imageURI,
            contentHash: contentHash,
            creator: creator
        });
        _safeMint(creator, 1);
    }

    function metadata() external view returns (ArtworkMetadata memory) {
        return artwork;
    }

    function artworkDid() external view returns (string memory) {
        return string.concat("did:art:artwork:", Strings.toHexString(uint160(address(this)), 20));
    }

    function setListed(bool listed) external {
        require(msg.sender == ownerOf(1), "Only current owner can change listing");
        require(isListed != listed, "Listing status unchanged");
        isListed = listed;
        emit ArtworkListingUpdated(address(this), listed, msg.sender);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return artwork.imageURI;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        if (to != address(0)) {
            address from = _ownerOf(tokenId);
            if (from != address(0)) {
                require(collectorRegistry.isListed(from), "Sender is unlisted");
            }
            require(collectorRegistry.isRegistered(to), "Receiver is not a registered collector");
            require(collectorRegistry.isListed(to), "Receiver is unlisted");
            require(isListed, "Artwork is unlisted");
        }
        return super._update(to, tokenId, auth);
    }
}
