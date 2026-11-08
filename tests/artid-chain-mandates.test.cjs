const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ethers = require('ethers');

const principal = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const artwork = '0x3333333333333333333333333333333333333333';
const mandate = '0x4444444444444444444444444444444444444444';
const hash = '0x' + 'ab'.repeat(32);
const abi = new ethers.Interface([
  'function createMandate(address,address[],uint64,uint256)',
  'function revokeMandate(uint256)',
  'function executeTransfer(uint256,address)',
  'event MandateCreated(uint256 indexed mandateId,address indexed principal,address indexed recipient,uint64 expiresAt,uint256 maxTransfers,address[] artworks)',
]);
const tokenAbi = new ethers.Interface(['function approve(address,uint256)']);

function setup() {
  const calls = [];
  let receipt;
  let operatorApproval = false;
  const provider = {
    getNetwork: async () => ({ chainId: 1337n }),
    getTransactionCount: async () => 1,
    estimateGas: async tx => { calls.push(tx); return 100000n; },
    send: async () => '0x1',
    broadcastTransaction: async () => ({ hash }),
    getTransactionReceipt: async () => receipt,
  };
  const browserEthers = {
    ...ethers,
    JsonRpcProvider: function () { return provider; },
    Contract: function (address) {
      if (address.toLowerCase() === mandate.toLowerCase()) {
        return {
          mandates: async id => id === 1n
            ? { principal, recipient, expiresAt: 2000000000n, remainingTransfers: 2n, revoked: false }
            : { principal: ethers.ZeroAddress },
          permittedArtwork: async (id, value) => value.toLowerCase() === artwork,
        };
      }
      return {
        ownerOf: async () => principal,
        getApproved: async () => ethers.ZeroAddress,
        isApprovedForAll: async () => operatorApproval,
      };
    },
  };
  const window = {
    ethers: browserEthers,
    ARTID_CONFIG: {
      qbesuPostUrl: 'https://example.test/rpc', chainId: 1337,
      walletReadAddressUrl: 'https://example.test/address',
      walletSignTransactionUrl: 'https://example.test/sign',
      slots: { alice: '1' }, mandateContractAddress: mandate,
    },
  };
  const fetch = async url => ({
    ok: true,
    json: async () => url.startsWith('https://example.test/address')
      ? { addr: principal } : { addr: principal, sig: '0x01' },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'artid-chain.js'), 'utf8');
  vm.runInNewContext(source, { window, fetch, URLSearchParams, setTimeout });
  return {
    client: window.ArtIDChain,
    calls,
    setReceipt: value => { receipt = value; },
    setOperatorApproval: value => { operatorApproval = value; },
  };
}

test('mandate writes encode the contract call and separate token approvals', async () => {
  const { client, calls } = setup();
  await client.connect('alice', 'test-pin');
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  assert.equal((await client.createMandate('alice', recipient, [artwork], expiry, 2)).txHash, hash);
  assert.equal(calls[0].to, mandate);
  const create = abi.decodeFunctionData('createMandate', calls[0].data);
  assert.equal(create[0], recipient);
  assert.deepEqual(Array.from(create[1]), [artwork]);
  assert.equal(create[2], BigInt(expiry));
  assert.equal(create[3], 2n);
  await client.setMandateApproval('alice', artwork, true);
  assert.equal(calls[1].to, artwork);
  assert.equal(tokenAbi.decodeFunctionData('approve', calls[1].data)[0], mandate);
  await client.executeMandate('alice', '1', artwork);
  assert.equal(calls[2].to, mandate);
  assert.equal(abi.decodeFunctionData('executeTransfer', calls[2].data)[0], 1n);
  await client.revokeMandate('alice', '1');
  assert.equal(abi.decodeFunctionData('revokeMandate', calls[3].data)[0], 1n);
  await client.setMandateApproval('alice', artwork, false);
  assert.equal(tokenAbi.decodeFunctionData('approve', calls[4].data)[0], ethers.ZeroAddress);
});

test('reads permission, ownership and operator approval, and rejects invalid input', async () => {
  const { client, calls, setOperatorApproval } = setup();
  let record = await client.getMandate('1', artwork);
  assert.equal(record.permitted, true);
  assert.equal(record.owner, principal);
  assert.equal(record.approved, false);
  setOperatorApproval(true);
  record = await client.getMandate('1', artwork);
  assert.equal(record.approved, true);
  assert.equal(record.approvedForAll, true);
  await assert.rejects(client.getMandate('2', artwork), /not found/);
  await assert.rejects(client.getMandate('0', artwork), /valid mandate ID/);
  await assert.rejects(client.executeMandate('alice', '1', 'invalid'), /valid artwork/);
  await assert.rejects(client.createMandate('alice', recipient, [artwork, artwork], 2000000000, 1), /unique/);
  assert.equal(calls.length, 0);
});

test('extracts the ID only from a confirmed creation event at the configured contract', async () => {
  const { client, setReceipt } = setup();
  const event = abi.encodeEventLog(abi.getEvent('MandateCreated'), [42, principal, recipient, 2000000000, 2, [artwork]]);
  setReceipt({ status: 1, logs: [
    { address: artwork, topics: event.topics, data: event.data },
    { address: mandate, topics: ['0x' + '00'.repeat(32)], data: '0x' },
    { address: mandate, topics: event.topics, data: event.data },
  ] });
  assert.equal(await client.createdMandateId(hash), '42');
  setReceipt({ status: 0, logs: [] });
  await assert.rejects(client.createdMandateId(hash), /receipt not found/);
  setReceipt({ status: 1, logs: [{ address: artwork, topics: event.topics, data: event.data }] });
  await assert.rejects(client.createdMandateId(hash), /event not found/);
});
