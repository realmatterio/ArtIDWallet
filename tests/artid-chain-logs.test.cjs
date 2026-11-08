const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'artid-chain.js');

function loadClient(provider, overrides = {}) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const marker = '  global.ArtIDChain = {';
  assert.equal(source.split(marker).length, 2);
  const instrumented = source.replace(marker, '  global.readLogsForTest = readLogsInRanges;\n' + marker);
  const window = {
    ARTID_CONFIG: {
      qbesuPostUrl: 'https://example.test/rpc',
      chainId: 1337,
      artworkFactoryDeploymentBlock: 3,
      factoryAddress: 'factory',
    },
    ethers: {
      JsonRpcProvider: function () { return provider; },
      isAddress: () => true,
      ...overrides,
    },
  };
  vm.runInNewContext(instrumented, { window, setTimeout, URLSearchParams });
  return window;
}

test('reads exact ranges and preserves results when responses finish out of order', async () => {
  const filters = [];
  const provider = {
    async getLogs(filter) {
      filters.push(filter);
      await new Promise(resolve => setTimeout(resolve, (10 - (filter.fromBlock - 3) / 500) * 2));
      return [{ block: filter.fromBlock }, { block: filter.toBlock }];
    },
  };
  const { readLogsForTest } = loadClient(provider);
  const logs = await readLogsForTest('contract', 'topic', 3, 5002);
  assert.deepEqual(filters.map(f => [f.fromBlock, f.toBlock]), [
    [3, 502], [503, 1002], [1003, 1502], [1503, 2002], [2003, 2502],
    [2503, 3002], [3003, 3502], [3503, 4002], [4003, 4502], [4503, 5002],
  ]);
  assert.deepEqual(Array.from(logs, log => log.block), [
    3, 502, 503, 1002, 1003, 1502, 1503, 2002, 2003, 2502,
    2503, 3002, 3003, 3502, 3503, 4002, 4003, 4502, 4503, 5002,
  ]);
  assert.ok(filters.every(f => f.address === 'contract' && f.topics[0] === 'topic'));
});

test('handles empty, single-block and partial final ranges', async () => {
  const filters = [];
  const { readLogsForTest } = loadClient({
    async getLogs(filter) {
      filters.push(filter);
      return [];
    },
  });
  assert.equal((await readLogsForTest('a', 't', 10, 9)).length, 0);
  assert.equal(filters.length, 0);
  await readLogsForTest('a', 't', 10, 10);
  await readLogsForTest('a', 't', 10, 510);
  assert.deepEqual(filters.map(f => [f.fromBlock, f.toBlock]), [[10, 10], [10, 509], [510, 510]]);
});

test('limits concurrent requests globally across independent scans', async () => {
  let active = 0;
  let peak = 0;
  const provider = {
    async getLogs(filter) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return [filter.fromBlock];
    },
  };
  const { readLogsForTest } = loadClient(provider);
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => readLogsForTest('contract' + i, 'topic', 0, 5499))
  );
  assert.equal(peak, 8);
  assert.equal(active, 0);
  for (const result of results) {
    assert.deepEqual(Array.from(result), [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]);
  }
});

test('propagates RPC errors and releases slots for queued and future scans', async () => {
  let active = 0;
  let peak = 0;
  const provider = {
    async getLogs(filter) {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 5));
        if (filter.address === 'failing' && filter.fromBlock === 0) throw new Error('RPC failed');
        return [filter.fromBlock];
      } finally {
        active -= 1;
      }
    },
  };
  const { readLogsForTest } = loadClient(provider);
  const failing = readLogsForTest('failing', 'topic', 0, 5999);
  const queued = readLogsForTest('queued', 'topic', 0, 5999);
  await assert.rejects(failing, /RPC failed/);
  assert.equal((await queued).length, 12);
  assert.equal((await readLogsForTest('later', 'topic', 0, 499)).length, 1);
  assert.equal(active, 0);
  assert.equal(peak, 8);
});

test('transfer history uses ordered ranges and preserves existing ledger order', async () => {
  const filters = [];
  const events = [
    { blockNumber: 10, args: { from: 'zero', to: 'alice' }, transactionHash: 'mint' },
    { blockNumber: 20, args: { from: 'alice', to: 'bob' }, transactionHash: 'transfer1' },
    { blockNumber: 900, args: { from: 'bob', to: 'alice' }, transactionHash: 'transfer2' },
  ];
  const provider = {
    async getBlockNumber() { return 1004; },
    async getLogs(filter) {
      filters.push(filter);
      await new Promise(resolve => setTimeout(resolve, filter.fromBlock === 3 ? 10 : 1));
      return events.filter(event => event.blockNumber >= filter.fromBlock && event.blockNumber <= filter.toBlock);
    },
    async getBlock(number) { return { timestamp: number }; },
  };
  const ethers = {
    ZeroAddress: 'zero',
    Contract: function () {
      return { artworkCount: async () => 1, artworkAt: async () => 'artwork' };
    },
    Interface: function () {
      return { getEvent: () => ({ topicHash: 'transfer-topic' }), parseLog: log => log };
    },
  };
  const { ArtIDChain } = loadClient(provider, ethers);
  const { transfers } = await ArtIDChain.ledger();
  assert.deepEqual(Array.from(transfers, transfer => transfer.transactionHash), ['transfer2', 'transfer1']);
  assert.deepEqual(filters.map(f => [f.fromBlock, f.toBlock]), [[3, 502], [503, 1002], [1003, 1004]]);
});

test('artwork listing chooses the newest event despite out-of-order responses', async () => {
  const provider = {
    async getBlockNumber() { return 1004; },
    async getLogs(filter) {
      await new Promise(resolve => setTimeout(resolve, filter.fromBlock === 3 ? 10 : 1));
      const events = filter.address === 'factory'
        ? [{ blockNumber: 10, transactionHash: 'created', args: { artworkContract: 'artwork' } }]
        : [
            { blockNumber: 20, transactionHash: 'older-listing' },
            { blockNumber: 900, transactionHash: 'newer-listing' },
          ];
      return events.filter(event => event.blockNumber >= filter.fromBlock && event.blockNumber <= filter.toBlock);
    },
  };
  const ethers = {
    Contract: function (address) {
      if (address === 'factory') {
        return {
          artworkCount: async () => 1,
          artworkAt: async () => 'artwork',
          getAddress: async () => 'factory',
        };
      }
      return {
        metadata: async () => ({ artworkId: 'id', title: 'Title', artist: 'Artist', imageURI: '', contentHash: '', creator: 'alice' }),
        artworkDid: async () => 'did',
        ownerOf: async () => 'alice',
        isListed: async () => true,
      };
    },
    Interface: function () {
      return { getEvent: name => ({ topicHash: name }), parseLog: log => log };
    },
  };
  const { ArtIDChain } = loadClient(provider, ethers);
  const { artworks } = await ArtIDChain.artworks();
  assert.equal(artworks.length, 1);
  assert.equal(artworks[0].creationTxHash, 'created');
  assert.equal(artworks[0].listingTxHash, 'newer-listing');
});
