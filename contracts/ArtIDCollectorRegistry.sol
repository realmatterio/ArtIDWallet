// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/Strings.sol";

contract ArtIDCollectorRegistry {
    struct Collector {
        string did;
        string displayName;
        string metadataURI;
        bool registered;
        bool listed;
    }

    mapping(address => Collector) private collectors;
    address[] private collectorAccounts;

    event CollectorRegistered(address indexed collector, string did, string displayName, string metadataURI);
    event CollectorMetadataUpdated(address indexed collector, string displayName, string metadataURI);
    event CollectorListingUpdated(address indexed collector, bool listed);

    function register(string calldata displayName, string calldata metadataURI) external {
        require(!collectors[msg.sender].registered, "Collector already registered");
        collectors[msg.sender] = Collector({
            did: collectorDid(msg.sender),
            displayName: displayName,
            metadataURI: metadataURI,
            registered: true,
            listed: true
        });
        collectorAccounts.push(msg.sender);
        emit CollectorRegistered(msg.sender, collectors[msg.sender].did, displayName, metadataURI);
    }

    function updateMetadata(string calldata displayName, string calldata metadataURI) external {
        require(collectors[msg.sender].registered, "Collector not registered");
        Collector storage collector = collectors[msg.sender];
        collector.displayName = displayName;
        collector.metadataURI = metadataURI;
        emit CollectorMetadataUpdated(msg.sender, displayName, metadataURI);
    }

    function setListed(bool listed) external {
        require(collectors[msg.sender].registered, "Collector not registered");
        Collector storage collector = collectors[msg.sender];
        require(collector.listed != listed, "Listing status unchanged");
        collector.listed = listed;
        emit CollectorListingUpdated(msg.sender, listed);
    }

    function getCollector(address account) external view returns (Collector memory) {
        return collectors[account];
    }

    function isRegistered(address account) external view returns (bool) {
        return collectors[account].registered;
    }

    function isListed(address account) external view returns (bool) {
        return collectors[account].listed;
    }

    function collectorCount() external view returns (uint256) {
        return collectorAccounts.length;
    }

    function collectorAt(uint256 index) external view returns (address) {
        return collectorAccounts[index];
    }

    function collectorDid(address account) public pure returns (string memory) {
        return string.concat("did:art:collector:", Strings.toHexString(uint160(account), 20));
    }
}
