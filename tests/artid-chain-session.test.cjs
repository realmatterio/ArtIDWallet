const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ethers = require('ethers');

const address = '0x1111111111111111111111111111111111111111';

function setup() {
  let lookups = 0;
  let fail = false;
  const window = {
    ARTID_CONFIG: {
      qbesuPostUrl: 'https://example.test/rpc',
      walletReadAddressUrl: 'https://example.test/address',
      collectorRegistryAddress: '0x2222222222222222222222222222222222222222',
      chainId: 1337,
      slots: { alice: 1 },
    },
    ethers: {
      ...ethers,
      JsonRpcProvider: function () { return { getNetwork: async () => ({ chainId: 1337n }) }; },
      Contract: function () {
        return { getCollector: async () => ({
          did: 'did:art:alice', displayName: 'Alice', metadataURI: '',
          registered: true, listed: true,
        }) };
      },
    },
  };
  const fetch = async () => {
    lookups += 1;
    return { ok: !fail, json: async () => fail ? { error: 'Invalid PIN' } : { addr: address } };
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'artid-chain.js'), 'utf8');
  vm.runInNewContext(source, { window, fetch, URLSearchParams, setTimeout });
  return {
    client: window.ArtIDChain,
    lookups: () => lookups,
    setFail: value => { fail = value; },
  };
}

test('wallet reuses the authenticated session address and clears it on lock', async () => {
  const { client, lookups } = setup();
  await client.connect('alice', 'test-pin');
  assert.equal((await client.wallet('alice')).address, address);
  assert.equal((await client.wallet('alice')).did, 'did:art:alice');
  assert.equal(lookups(), 1);
  client.lock('alice');
  await assert.rejects(client.wallet('alice'), /Unlock Artist Alice/);
  await client.connect('alice', 'test-pin');
  assert.equal(lookups(), 2);
  client.lock();
  await assert.rejects(client.wallet('alice'), /Unlock Artist Alice/);
});

test('a failed reconnect removes the previous authenticated session', async () => {
  const { client, lookups, setFail } = setup();
  await client.connect('alice', 'test-pin');
  setFail(true);
  await assert.rejects(client.connect('alice', 'wrong-pin'), /Invalid PIN/);
  assert.equal(client.isConnected('alice'), false);
  await assert.rejects(client.wallet('alice'), /Unlock Artist Alice/);
  assert.equal(lookups(), 2);
});

test('a session is not connected while authentication is pending', async () => {
  const { client } = setup();
  const connecting = client.connect('alice', 'test-pin');
  assert.equal(client.isConnected('alice'), false);
  await connecting;
  assert.equal(client.isConnected('alice'), true);
});
