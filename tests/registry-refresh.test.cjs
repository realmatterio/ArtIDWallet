const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function setup(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('  let registryRefresh = null;');
  const end = source.indexOf('  async function runRegistryRefresh()', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = {
    runRegistryRefresh() {
      return new Promise((resolve, reject) => calls.push({ resolve, reject }));
    },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.refresh = refreshChainState;', context);
  return { refresh: context.refresh, calls };
}

for (const file of ['human-wallet.html', 'agent-wallet.js']) {
  test(`${file} shares an in-flight scan and queues a fresh post-write scan`, async () => {
    const { refresh, calls } = setup(file);
    const initial = refresh();
    assert.equal(refresh(), initial);
    const forced = refresh(true);
    assert.equal(calls.length, 1);
    calls[0].resolve('initial');
    assert.equal(await initial, 'initial');
    await Promise.resolve();
    assert.equal(calls.length, 2);
    assert.equal(refresh(), forced);
    calls[1].resolve('fresh');
    assert.equal(await forced, 'fresh');
    const next = refresh();
    assert.equal(calls.length, 3);
    calls[2].resolve('next');
    assert.equal(await next, 'next');
  });

  test(`${file} propagates failure and permits a queued retry`, async () => {
    const { refresh, calls } = setup(file);
    const initial = refresh();
    const retry = refresh(true);
    calls[0].reject(new Error('RPC failed'));
    await assert.rejects(initial, /RPC failed/);
    await Promise.resolve();
    assert.equal(calls.length, 2);
    calls[1].resolve('recovered');
    assert.equal(await retry, 'recovered');
  });
}
