(function (global) {
  'use strict';

  const config = global.ARTID_CONFIG || {};
  const ethers = global.ethers;
  const sessionPins = {};
  let provider;

  const factoryAbi = [
    'function artworkCount() view returns (uint256)',
    'function artworkAt(uint256) view returns (address)',
    'function createArtwork(string,string,string,string,string)',
  ];
  const collectorAbi = [
    'function register(string,string)',
    'function updateMetadata(string,string)',
    'function setListed(bool)',
    'function getCollector(address) view returns (tuple(string did,string displayName,string metadataURI,bool registered,bool listed))',
    'function isRegistered(address) view returns (bool)',
    'function isListed(address) view returns (bool)',
    'function collectorCount() view returns (uint256)',
    'function collectorAt(uint256) view returns (address)',
    'event CollectorRegistered(address indexed collector,string did,string displayName,string metadataURI)',
    'event CollectorMetadataUpdated(address indexed collector,string displayName,string metadataURI)',
    'event CollectorListingUpdated(address indexed collector,bool listed)',
  ];
  const artworkAbi = [
    'function metadata() view returns (tuple(string artworkId,string title,string artist,string imageURI,string contentHash,address creator))',
    'function artworkDid() view returns (string)',
    'function isListed() view returns (bool)',
    'function setListed(bool)',
    'function ownerOf(uint256) view returns (address)',
    'function safeTransferFrom(address,address,uint256)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
    'event ArtworkListingUpdated(address indexed artworkContract,bool listed,address indexed changedBy)',
  ];
  const factoryEvents = [
    'event ArtworkCreated(address indexed artworkContract,address indexed creator,uint256 indexed tokenId,string artworkId,string did)',
  ];

  function configuredAddress(address, name) {
    if (!ethers || !ethers.isAddress(address)) {
      throw new Error('Set a valid ' + name + ' address in artid-config.js.');
    }
    return address;
  }

  function requirePin(profile) {
    if (!sessionPins[profile]) throw new Error('Unlock ' + profileLabel(profile) + ' with its ICCHSM wallet PIN.');
    return sessionPins[profile];
  }

  function profileLabel(profile) {
    return profile === 'alice' ? 'Artist Alice' : 'Collector Bob';
  }

  function getProvider() {
    if (!ethers) throw new Error('The ethers.js library did not load.');
    if (!config.qbesuPostUrl || !/^https:\/\//i.test(config.qbesuPostUrl)) {
      throw new Error('Set the HTTPS qBESU proxy URL in artid-config.js.');
    }
    if (!provider) {
      provider = new ethers.JsonRpcProvider(
        config.qbesuPostUrl,
        Number(config.chainId),
        { staticNetwork: true }
      );
    }
    return provider;
  }

  async function getAddress(profile) {
    const slot = config.slots && config.slots[profile];
    if (!slot) throw new Error('No ICCHSM slot is configured for ' + profile + '.');
    if (!/^https:\/\//i.test(config.walletReadAddressUrl || '')) {
      throw new Error('Set the HTTPS wallet address proxy URL in artid-config.js.');
    }
    const params = new URLSearchParams({
      slot: String(slot),
      pin: requirePin(profile),
      mechanism: 'besu',
    });
    const response = await fetch(config.walletReadAddressUrl + '?' + params, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok || result.error || !ethers.isAddress(result.addr)) {
      throw new Error(result.error || 'ICCHSM wallet address lookup failed.');
    }
    return result.addr;
  }

  async function submit(profile, to, data) {
    const pin = requirePin(profile);
    const slot = config.slots && config.slots[profile];
    if (!slot) throw new Error('No ICCHSM slot is configured for ' + profile + '.');
    if (!/^https:\/\//i.test(config.walletSignTransactionUrl || '')) {
      throw new Error('Set the HTTPS wallet signing proxy URL in artid-config.js.');
    }

    const from = await getAddress(profile);
    const rpc = getProvider();
    const network = await rpc.getNetwork();
    if (Number(network.chainId) !== Number(config.chainId)) {
      throw new Error('Connected qBESU network does not match configured chain ID.');
    }
    const [nonce, gas, gasPrice] = await Promise.all([
      rpc.getTransactionCount(from, 'pending'),
      rpc.estimateGas({ from: from, to: to, data: data, value: 0 }),
      rpc.send('eth_gasPrice', []),
    ]);
    const transaction = ethers.Transaction.from({
      type: 0,
      chainId: Number(config.chainId),
      nonce: nonce,
      gasLimit: gas,
      gasPrice: BigInt(gasPrice),
      to: to,
      value: 0,
      data: data,
    });
    const params = new URLSearchParams({
      slot: String(slot),
      pin: pin,
      mechanism: 'besu',
      hashedTransaction: transaction.unsignedSerialized,
      nonce: String(nonce),
      gas: gas.toString(),
      to: to,
      value: '0',
      data: data,
      chainId: String(config.chainId),
      gasPrice: BigInt(gasPrice).toString(),
    });
    const response = await fetch(config.walletSignTransactionUrl + '?' + params, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const signed = await response.json().catch(function () { return {}; });
    if (!response.ok || signed.error || !ethers.isHexString(signed.sig)) {
      throw new Error(signed.error || 'ICCHSM transaction signing failed.');
    }
    if (signed.addr && signed.addr.toLowerCase() !== from.toLowerCase()) {
      throw new Error('ICCHSM signed with a different wallet than requested.');
    }
    return rpc.broadcastTransaction(signed.sig);
  }

  async function collectorContract() {
    return new ethers.Contract(
      configuredAddress(config.collectorRegistryAddress, 'collector registry'),
      collectorAbi,
      getProvider()
    );
  }

  function configuredStartBlock(name) {
    if (config[name] === null || config[name] === undefined || config[name] === '') {
      throw new Error('Set ' + name + ' in artid-config.js after deploying the v2 contracts.');
    }
    const block = Number(config[name]);
    if (!Number.isSafeInteger(block) || block < 0) {
      throw new Error('Set ' + name + ' in artid-config.js after deploying the v2 contracts.');
    }
    return block;
  }

  async function readLogsInRanges(address, topic, startBlock, latestBlock) {
    const logs = [];
    for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += 500) {
      logs.push(...await getProvider().getLogs({
        address: address,
        topics: [topic],
        fromBlock: fromBlock,
        toBlock: Math.min(fromBlock + 499, latestBlock),
      }));
    }
    return logs;
  }

  async function listCollectors() {
    const registry = await collectorContract();
    const count = Number(await registry.collectorCount());
    if (!Number.isSafeInteger(count) || count > 1000) {
      throw new Error('Collector directory exceeds the demo query limit.');
    }
    const startBlock = configuredStartBlock('collectorRegistryDeploymentBlock');
    const latestBlock = await getProvider().getBlockNumber();
    const registeredTopic = registry.interface.getEvent('CollectorRegistered').topicHash;
    const metadataTopic = registry.interface.getEvent('CollectorMetadataUpdated').topicHash;
    const listingTopic = registry.interface.getEvent('CollectorListingUpdated').topicHash;
    const [registeredLogs, metadataLogs, listingLogs] = await Promise.all([
      readLogsInRanges(await registry.getAddress(), registeredTopic, startBlock, latestBlock),
      readLogsInRanges(await registry.getAddress(), metadataTopic, startBlock, latestBlock),
      readLogsInRanges(await registry.getAddress(), listingTopic, startBlock, latestBlock),
    ]);
    const byAddress = new Map();
    for (const log of registeredLogs) {
      const parsed = registry.interface.parseLog(log);
      const address = parsed.args.collector.toLowerCase();
      const entry = byAddress.get(address) || { metadataHistory: [], registrationTxHash: null, listingTxHash: null };
      entry.registrationTxHash = log.transactionHash;
      entry.metadataHistory.push({
        displayName: parsed.args.displayName,
        metadataURI: parsed.args.metadataURI,
        transactionHash: log.transactionHash,
      });
      byAddress.set(address, entry);
    }
    for (const log of metadataLogs) {
      const parsed = registry.interface.parseLog(log);
      const address = parsed.args.collector.toLowerCase();
      const entry = byAddress.get(address) || { metadataHistory: [], registrationTxHash: null, listingTxHash: null };
      entry.metadataHistory.push({
        displayName: parsed.args.displayName,
        metadataURI: parsed.args.metadataURI,
        transactionHash: log.transactionHash,
      });
      byAddress.set(address, entry);
    }
    for (const log of listingLogs) {
      const parsed = registry.interface.parseLog(log);
      const address = parsed.args.collector.toLowerCase();
      const entry = byAddress.get(address) || { metadataHistory: [], registrationTxHash: null, listingTxHash: null };
      entry.listingTxHash = log.transactionHash;
      byAddress.set(address, entry);
    }
    const records = [];
    for (let index = 0; index < count; index += 1) {
      const address = await registry.collectorAt(index);
      const record = await registry.getCollector(address);
      const history = byAddress.get(address.toLowerCase()) || { metadataHistory: [], registrationTxHash: null, listingTxHash: null };
      records.push({
        address: address,
        did: record.did,
        displayName: record.displayName,
        metadataURI: record.metadataURI,
        registered: record.registered,
        listed: record.listed,
        registrationTxHash: history.registrationTxHash,
        metadataHistory: history.metadataHistory,
        listingTxHash: history.listingTxHash,
      });
    }
    return records;
  }

  async function artworkEventHashes(factoryAddress, artworkAddresses) {
    const startBlock = configuredStartBlock('artworkFactoryDeploymentBlock');
    const latestBlock = await getProvider().getBlockNumber();
    const factory = new ethers.Interface(factoryAbi.concat(factoryEvents));
    const createdTopic = factory.getEvent('ArtworkCreated').topicHash;
    const createdLogs = await readLogsInRanges(factoryAddress, createdTopic, startBlock, latestBlock);
    const hashes = new Map();
    for (const log of createdLogs) {
      const parsed = factory.parseLog(log);
      hashes.set(parsed.args.artworkContract.toLowerCase(), {
        creationTxHash: log.transactionHash,
        listingTxHash: null,
      });
    }
    const iface = new ethers.Interface(artworkAbi);
    const listingTopic = iface.getEvent('ArtworkListingUpdated').topicHash;
    for (const address of artworkAddresses) {
      const logs = await readLogsInRanges(address, listingTopic, startBlock, latestBlock);
      const entry = hashes.get(address.toLowerCase()) || { creationTxHash: null, listingTxHash: null };
      if (logs.length) entry.listingTxHash = logs[logs.length - 1].transactionHash;
      hashes.set(address.toLowerCase(), entry);
    }
    return hashes;
  }

  async function waitForReceipt(hash, onPending) {
    let waitSeconds = 3;
    while (true) {
      await new Promise(function (resolve) {
        setTimeout(resolve, waitSeconds * 1000);
      });
      try {
        const receipt = await getProvider().getTransactionReceipt(hash);
        if (receipt) {
          return {
            status: receipt.status === 1 ? 'confirmed' : 'failed',
            blockNumber: receipt.blockNumber,
            txHash: hash,
          };
        }
        if (onPending) onPending({ status: 'pending' });
      } catch (error) {
        if (onPending) onPending({ status: 'pending', temporaryError: true });
      }
      waitSeconds = Math.min(20, waitSeconds + 4);
    }
  }

  async function listArtworks() {
    const factory = new ethers.Contract(
      configuredAddress(config.factoryAddress, 'artwork factory'),
      factoryAbi,
      getProvider()
    );
    const count = Number(await factory.artworkCount());
    if (!Number.isSafeInteger(count) || count > 1000) {
      throw new Error('Artwork catalog exceeds the demo query limit.');
    }
    const records = [];
    const addresses = [];
    for (let index = 0; index < count; index += 1) {
      addresses.push(await factory.artworkAt(index));
    }
    const hashes = await artworkEventHashes(await factory.getAddress(), addresses);
    for (const address of addresses) {
      const contract = new ethers.Contract(address, artworkAbi, getProvider());
      const [metadata, did, owner, listed] = await Promise.all([
        contract.metadata(),
        contract.artworkDid(),
        contract.ownerOf(1),
        contract.isListed(),
      ]);
      const eventHashes = hashes.get(address.toLowerCase()) || {};
      records.push({
        address: address,
        tokenId: '1',
        artworkId: metadata.artworkId,
        title: metadata.title,
        artist: metadata.artist,
        imageURI: metadata.imageURI,
        contentHash: metadata.contentHash,
        creator: metadata.creator,
        did: did,
        owner: owner,
        listed: listed,
        creationTxHash: eventHashes.creationTxHash,
        listingTxHash: eventHashes.listingTxHash,
      });
    }
    return records;
  }

  async function listTransfers() {
    const factory = new ethers.Contract(
      configuredAddress(config.factoryAddress, 'artwork factory'),
      factoryAbi,
      getProvider()
    );
    const count = Number(await factory.artworkCount());
    if (!Number.isSafeInteger(count) || count > 1000) {
      throw new Error('Artwork catalog exceeds the demo query limit.');
    }
    const iface = new ethers.Interface(artworkAbi);
    const topic = iface.getEvent('Transfer').topicHash;
    const transfers = [];
    const deploymentBlock = configuredStartBlock('artworkFactoryDeploymentBlock');
    const latestBlock = await getProvider().getBlockNumber();
    for (let index = 0; index < count; index += 1) {
      const address = await factory.artworkAt(index);
      const logs = [];
      for (let fromBlock = deploymentBlock; fromBlock <= latestBlock; fromBlock += 500) {
        logs.push(...await getProvider().getLogs({
          address: address,
          topics: [topic],
          fromBlock: fromBlock,
          toBlock: Math.min(fromBlock + 499, latestBlock),
        }));
      }
      for (const log of logs) {
        const parsed = iface.parseLog(log);
        if (parsed.args.from === ethers.ZeroAddress) continue;
        const block = await getProvider().getBlock(log.blockNumber);
        transfers.push({
          time: block ? new Date(Number(block.timestamp) * 1000).toLocaleString() : '',
          artwork: address,
          from: parsed.args.from,
          to: parsed.args.to,
          transactionHash: log.transactionHash,
        });
      }
    }
    return transfers.reverse();
  }

  global.ArtIDChain = {
    connect: async function (profile, pin) {
      if (!String(pin || '').trim()) throw new Error('Enter the ICCHSM wallet PIN.');
      if (!config.slots || !config.slots[profile]) throw new Error('No ICCHSM slot is configured for this wallet.');
      sessionPins[profile] = String(pin);
      try {
        const [address, network] = await Promise.all([getAddress(profile), getProvider().getNetwork()]);
        if (Number(network.chainId) !== Number(config.chainId)) {
          throw new Error('Connected qBESU network does not match configured chain ID.');
        }
        return { profile: profile, address: address, chainId: Number(network.chainId) };
      } catch (error) {
        delete sessionPins[profile];
        throw error;
      }
    },
    lock: function (profile) {
      if (profile) delete sessionPins[profile];
      else Object.keys(sessionPins).forEach(key => delete sessionPins[key]);
    },
    isConnected: function (profile) { return Boolean(sessionPins[profile]); },
    health: async function () {
      const network = await getProvider().getNetwork();
      return { chainId: Number(network.chainId) };
    },
    wallet: async function (profile) {
      const address = await getAddress(profile);
      const registry = await collectorContract();
      const record = await registry.getCollector(address);
      return {
        profile: profile,
        address: address,
        did: record.registered ? record.did : null,
        displayName: record.registered ? record.displayName : null,
        metadataURI: record.registered ? record.metadataURI : null,
        registered: record.registered,
        listed: record.registered ? record.listed : false,
      };
    },
    collectors: async function () { return { collectors: await listCollectors() }; },
    artworks: async function () { return { artworks: await listArtworks() }; },
    ledger: async function () { return { transfers: await listTransfers() }; },
    registerCollector: async function (profile, displayName, metadataURI) {
      const registry = await collectorContract();
      const data = registry.interface.encodeFunctionData(
        'register', [displayName, metadataURI || '']
      );
      const tx = await submit(profile, await registry.getAddress(), data);
      return { txHash: tx.hash };
    },
    updateCollector: async function (profile, displayName, metadataURI) {
      const registry = await collectorContract();
      const data = registry.interface.encodeFunctionData(
        'updateMetadata', [displayName, metadataURI || '']
      );
      const tx = await submit(profile, await registry.getAddress(), data);
      return { txHash: tx.hash };
    },
    setCollectorListed: async function (profile, listed) {
      const registry = await collectorContract();
      const data = registry.interface.encodeFunctionData('setListed', [listed]);
      const tx = await submit(profile, await registry.getAddress(), data);
      return { txHash: tx.hash };
    },
    createArtwork: async function (profile, metadata) {
      const factoryAddress = configuredAddress(config.factoryAddress, 'artwork factory');
      const factory = new ethers.Interface(factoryAbi);
      const data = factory.encodeFunctionData('createArtwork', [
        metadata.artworkId,
        metadata.title,
        metadata.artist || '',
        metadata.imageURI || '',
        metadata.contentHash || '',
      ]);
      const tx = await submit(profile, factoryAddress, data);
      return { txHash: tx.hash };
    },
    transfer: async function (contractAddress, fromProfile, toProfile) {
      const from = await getAddress(fromProfile);
      const to = await getAddress(toProfile);
      const contract = new ethers.Interface(artworkAbi);
      const data = contract.encodeFunctionData('safeTransferFrom', [from, to, 1]);
      const tx = await submit(fromProfile, contractAddress, data);
      return { txHash: tx.hash };
    },
    setArtworkListed: async function (contractAddress, profile, listed) {
      const contract = new ethers.Interface(artworkAbi);
      const data = contract.encodeFunctionData('setListed', [listed]);
      const tx = await submit(profile, contractAddress, data);
      return { txHash: tx.hash };
    },
    waitForReceipt: waitForReceipt,
  };
})(window);
