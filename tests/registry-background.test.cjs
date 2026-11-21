const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function setup(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('  function queueHistoryRefresh(generation)');
  const end = source.indexOf(file.endsWith('.html') ? '  async function refreshPublicRegistry' : '  async function refreshRegistry', start);
  assert.ok(start >= 0 && end > start);
  const pending = [];
  const status = { textContent: '' };
  const state = {
    collectors: [{ address: 'COLLECTOR', displayName: 'Current', metadataHistory: [] }],
    artworks: [{ address: 'ARTWORK', owner: 'Current owner' }],
    ledger: [], accounts: {}, user: null, account: null, view: 'portal',
    historyStatus: 'loading',
  };
  const errors = [];
  const chainContext = { window: { ARTID_CONFIG: {}, ethers: {} }, setTimeout, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'artid-chain.js'), 'utf8'), chainContext);
  const context = {
    state, profiles: [], isConnected: () => false, sameAddress: (a, b) => a.toLowerCase() === b.toLowerCase(),
    $: () => status,
    ArtIDChain: {
      history: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      applyHistory: chainContext.window.ArtIDChain.applyHistory,
    },
    renderCollector() {}, renderCollection() {}, renderBobFolder() {}, renderRegistry() {}, renderLedger() {}, renderPage() {},
    console: { error: (...args) => errors.push(args) },
  };
  vm.runInNewContext(`
    let historyRefresh = Promise.resolve();
    let historyGeneration = 0;
    ${source.slice(start, end)}
    this.queue = generation => { historyGeneration = generation; queueHistoryRefresh(generation); };
    this.done = () => historyRefresh;
  `, context);
  return { ...context, pending, status, errors };
}

for (const file of ['human-wallet.html', 'agent-wallet.js']) {
  test(`${file} applies history without replacing newer current state`, async () => {
    const h = setup(file);
    h.queue(1);
    await Promise.resolve();
    h.pending[0].resolve({
      collectors: [{ address: 'collector', displayName: 'Old', metadataHistory: [{ displayName: 'Old' }], registrationTxHash: 'registration', listingTxHash: 'collector-listing' }],
      artworks: [{ address: 'artwork', owner: 'Old owner', creationTxHash: 'creation', listingTxHash: 'art-listing' }],
      transfers: [{ artwork: 'artwork', transactionHash: 'transfer' }],
    });
    await h.done();
    assert.equal(h.state.collectors[0].displayName, 'Current');
    assert.equal(h.state.collectors[0].registrationTxHash, 'registration');
    assert.equal(h.state.artworks[0].owner, 'Current owner');
    assert.equal(h.state.artworks[0].creationTxHash, 'creation');
    assert.equal(h.state.artworks[0].transferTxHash, 'transfer');
    assert.equal(h.state.historyStatus, 'ready');
    assert.match(h.status.textContent, /history in sync/);
  });

  test(`${file} ignores stale history and serializes the next scan`, async () => {
    const h = setup(file);
    h.queue(1);
    await Promise.resolve();
    h.queue(2);
    assert.equal(h.pending.length, 1);
    h.pending[0].resolve({ collectors: [], artworks: [], transfers: [{ artwork: 'ARTWORK', transactionHash: 'stale' }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.pending.length, 2);
    assert.equal(h.state.ledger.length, 0);
    h.pending[1].resolve({ collectors: [], artworks: [], transfers: [] });
    await h.done();
    assert.equal(h.state.historyStatus, 'ready');
    assert.equal(h.state.artworks[0].transferTxHash, null);
  });

  test(`${file} reports history failure without discarding current state`, async () => {
    const h = setup(file);
    h.queue(1);
    await Promise.resolve();
    h.pending[0].reject(new Error('RPC failed'));
    await h.done();
    assert.equal(h.state.historyStatus, 'error');
    assert.equal(h.state.collectors[0].displayName, 'Current');
    assert.match(h.status.textContent, /history could not be loaded/);
    assert.equal(h.errors.length, 1);
  });
}
