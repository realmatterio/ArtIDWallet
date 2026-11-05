#!/usr/bin/env node
/* ==========================================================================
   art-id-registry-mcp.mjs

   A read-only MCP server (stdio) for the public ArtID Registry on qBESU.
   It reads artworks, collectors and transfers straight from the chain via
   the qBESU JSON-RPC proxy: no browser, no wallet, no PIN. It never signs or
   sends a transaction; the only RPC methods it uses are eth_chainId,
   eth_blockNumber, eth_call, eth_getLogs and eth_getBlockByNumber.

   Addresses, chain ID, deployment blocks and the proxy URL come from
   artid-config.js, the same file the browser wallet loads.

   No dependencies: Node 22+ (global fetch). The handful of ABI calls and
   events it needs are encoded/decoded by hand below, and the selectors and
   topic hashes are derived at startup with the small Keccak-256 below.

   To act on the registry (log in, sell, buy, register, list/unlist) use the
   artid-wallet server (scripts/webmcp-mcp-server.mjs) instead.

   Environment:
     REGISTRY_CACHE_MS   how long chain reads are reused (default 30000)
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CACHE_MS = Number(process.env.REGISTRY_CACHE_MS || 30000);
const LOG_RANGE = 500;          // the proxy rejects wider eth_getLogs ranges
const BATCH = 50;               // JSON-RPC requests per HTTP POST
const DEMO_LIMIT = 1000;        // same sanity cap as artid-chain.js
const EXPLORER = 'https://quantumbesu.web.app/quantumbesu.html?transaction=';
const ZERO = '0x0000000000000000000000000000000000000000';

// stdout carries the MCP protocol, so anything for humans goes to stderr
const log = (...args) => console.error('[art-id-registry]', ...args);

/* ---------------- config: artid-config.js is the source of truth ---------------- */

function loadConfig() {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(resolve(ROOT, 'artid-config.js'), 'utf8'), sandbox, { timeout: 1000 });
  const c = sandbox.window.ARTID_CONFIG;
  if (!c || !/^https:\/\//i.test(c.qbesuPostUrl || '')) throw new Error('artid-config.js has no HTTPS qbesuPostUrl.');
  for (const key of ['collectorRegistryAddress', 'factoryAddress']) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(c[key] || '')) throw new Error(`artid-config.js has no valid ${key}.`);
  }
  return {
    chainId: Number(c.chainId),
    rpcUrl: c.qbesuPostUrl,
    registry: c.collectorRegistryAddress,
    factory: c.factoryAddress,
    registryBlock: Number(c.collectorRegistryDeploymentBlock),
    factoryBlock: Number(c.artworkFactoryDeploymentBlock)
  };
}
const CONFIG = loadConfig();

/* ---------------- Keccak-256 (Ethereum variant, 0x01 padding) ----------------
   Used only for function selectors, event topics and EIP-55 checksums. */

const MASK = (1n << 64n) - 1n;
const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn,
  0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n,
  0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n,
  0x80000001n, 0x8000000080008008n];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rotl = (x, n) => n ? ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK : x;

function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const C = [0, 1, 2, 3, 4].map(x => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[y + x] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
    s[0] ^= RC[round];
  }
}

function keccak256(text) {
  const bytes = [...new TextEncoder().encode(text), 0x01];
  while (bytes.length % 136) bytes.push(0);
  bytes[bytes.length - 1] |= 0x80;
  const s = new Array(25).fill(0n);
  for (let o = 0; o < bytes.length; o += 136) {
    for (let i = 0; i < 17; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(bytes[o + i * 8 + b]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  let hex = '';
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) hex += Number((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return '0x' + hex;
}

// self-check against the well-known ERC-721 Transfer topic
if (keccak256('Transfer(address,address,uint256)') !== '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
  throw new Error('Keccak self-check failed.');
}

const selector = signature => keccak256(signature).slice(0, 10);
const SEL = {
  artworkCount: selector('artworkCount()'),
  artworkAt: selector('artworkAt(uint256)'),
  collectorCount: selector('collectorCount()'),
  collectorAt: selector('collectorAt(uint256)'),
  getCollector: selector('getCollector(address)'),
  metadata: selector('metadata()'),
  artworkDid: selector('artworkDid()'),
  isListed: selector('isListed()'),
  ownerOf: selector('ownerOf(uint256)')
};
const TOPIC = {
  collectorRegistered: keccak256('CollectorRegistered(address,string,string,string)'),
  collectorMetadataUpdated: keccak256('CollectorMetadataUpdated(address,string,string)'),
  collectorListingUpdated: keccak256('CollectorListingUpdated(address,bool)'),
  artworkCreated: keccak256('ArtworkCreated(address,address,uint256,string,string)'),
  artworkListingUpdated: keccak256('ArtworkListingUpdated(address,bool,address)'),
  transfer: keccak256('Transfer(address,address,uint256)')
};

/* ---------------- minimal ABI encoding / decoding ----------------
   Every value is a 32-byte word. Dynamic values (strings, tuples holding
   strings) are stored as a byte offset to their data; a string's data is a
   length word followed by the UTF-8 bytes. */

const word = n => BigInt(n).toString(16).padStart(64, '0');
const encodeAddress = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

function checksum(address) {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = keccak256(lower).slice(2);
  return '0x' + [...lower].map((c, i) => parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c).join('');
}

class Abi {
  constructor(hex) { this.hex = String(hex || '0x').replace(/^0x/, ''); }
  word(byteOffset) {
    const w = this.hex.slice(byteOffset * 2, byteOffset * 2 + 64);
    if (w.length !== 64) throw new Error('Unexpected short ABI data.');
    return w;
  }
  uint(byteOffset) { return BigInt('0x' + this.word(byteOffset)); }
  number(byteOffset) { return Number(this.uint(byteOffset)); }
  bool(byteOffset) { return this.uint(byteOffset) !== 0n; }
  address(byteOffset) { return checksum('0x' + this.word(byteOffset).slice(24)); }
  // string whose offset word sits at `head`, offset counted from `base`
  string(head, base = 0) {
    const start = base + this.number(head);
    const length = this.number(start);
    return Buffer.from(this.hex.slice((start + 32) * 2, (start + 32 + length) * 2), 'hex').toString('utf8');
  }
}

const topicAddress = topic => checksum('0x' + topic.slice(-40));

/* ---------------- JSON-RPC to qBESU (read-only methods only) ---------------- */

const READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getLogs', 'eth_getBlockByNumber']);

async function rpcBatch(calls) {
  for (const [method] of calls) if (!READ_METHODS.has(method)) throw new Error('Refusing non-read RPC method ' + method);
  const results = [];
  for (let i = 0; i < calls.length; i += BATCH) {
    const chunk = calls.slice(i, i + BATCH).map(([method, params], j) => ({ jsonrpc: '2.0', id: j, method, params }));
    const response = await fetch(CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) throw new Error(`qBESU proxy answered HTTP ${response.status}.`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('qBESU proxy: ' + (body?.error?.message || 'unexpected batch reply'));
    const byId = new Map(body.map(r => [r.id, r]));
    for (const request of chunk) {
      const r = byId.get(request.id);
      if (!r) throw new Error(`qBESU proxy dropped a ${request.method} reply.`);
      if (r.error) throw new Error(`${request.method} failed: ${r.error.message}`);
      results.push(r.result);
    }
  }
  return results;
}

const call = (to, data) => ['eth_call', [{ to, data }, 'latest']];

async function getLogs(addresses, fromBlock, toBlock) {
  const calls = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_RANGE) {
    calls.push(['eth_getLogs', [{
      address: addresses,
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + Math.min(from + LOG_RANGE - 1, toBlock).toString(16)
    }]]);
  }
  return (await rpcBatch(calls)).flat();
}

/* ---------------- registry snapshot (cached) ---------------- */

let cache = null; // { at, promise }

function snapshot(refresh) {
  if (refresh || !cache || Date.now() - cache.at > CACHE_MS) {
    const promise = readRegistry();
    cache = { at: Date.now(), promise };
    promise.catch(() => { if (cache?.promise === promise) cache = null; });
  }
  return cache.promise;
}

async function readRegistry() {
  const started = Date.now();
  const [chainIdHex, latestHex, artworkCountHex, collectorCountHex] = await rpcBatch([
    ['eth_chainId', []], ['eth_blockNumber', []],
    call(CONFIG.factory, SEL.artworkCount), call(CONFIG.registry, SEL.collectorCount)
  ]);
  const chainId = Number(chainIdHex);
  if (chainId !== CONFIG.chainId) throw new Error(`qBESU reports chain ${chainId}, artid-config.js expects ${CONFIG.chainId}.`);
  const latestBlock = Number(latestHex);
  const artworkCount = new Abi(artworkCountHex).number(0);
  const collectorCount = new Abi(collectorCountHex).number(0);
  if (artworkCount > DEMO_LIMIT || collectorCount > DEMO_LIMIT) throw new Error('Registry exceeds the demo query limit.');

  const addresses = (await rpcBatch([
    ...Array.from({ length: artworkCount }, (_, i) => call(CONFIG.factory, SEL.artworkAt + word(i))),
    ...Array.from({ length: collectorCount }, (_, i) => call(CONFIG.registry, SEL.collectorAt + word(i)))
  ])).map(hex => new Abi(hex).address(0));
  const artworkAddresses = addresses.slice(0, artworkCount);
  const collectorAddresses = addresses.slice(artworkCount);

  // current state (4 calls per artwork, 1 per collector) and every event, in parallel
  const startBlock = Math.min(CONFIG.registryBlock, CONFIG.factoryBlock);
  const [stateReplies, logs] = await Promise.all([
    rpcBatch([
      ...artworkAddresses.flatMap(a => [
        call(a, SEL.metadata), call(a, SEL.artworkDid), call(a, SEL.ownerOf + word(1)), call(a, SEL.isListed)
      ]),
      ...collectorAddresses.map(a => call(CONFIG.registry, SEL.getCollector + encodeAddress(a)))
    ]),
    getLogs([CONFIG.registry, CONFIG.factory, ...artworkAddresses], startBlock, latestBlock)
  ]);

  // block timestamps for every block that holds an event we report
  const blocks = [...new Set(logs.map(l => l.blockNumber))];
  const blockReplies = await rpcBatch(blocks.map(b => ['eth_getBlockByNumber', [b, false]]));
  const timeOf = new Map(blocks.map((b, i) => [b, blockReplies[i] ? new Date(Number(blockReplies[i].timestamp) * 1000).toISOString() : null]));

  const eventRef = l => ({ txHash: l.transactionHash, block: Number(l.blockNumber), time: timeOf.get(l.blockNumber) });
  logs.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));

  const collectorEvents = new Map(); // lowercase address -> { registration, metadataHistory, listingHistory }
  const artworkEvents = new Map();   // lowercase contract -> { creation, listingHistory }
  const transfers = [];
  const entry = (map, key, empty) => { if (!map.has(key)) map.set(key, empty()); return map.get(key); };
  const collectorEntry = a => entry(collectorEvents, a.toLowerCase(), () => ({ registration: null, metadataHistory: [], listingHistory: [] }));
  const artworkEntry = a => entry(artworkEvents, a.toLowerCase(), () => ({ creation: null, listingHistory: [] }));

  for (const l of logs) {
    const data = new Abi(l.data);
    const topic = l.topics[0];
    const source = l.address.toLowerCase();
    if (source === CONFIG.registry.toLowerCase()) {
      if (topic === TOPIC.collectorRegistered) {
        const e = collectorEntry(topicAddress(l.topics[1]));
        e.registration = eventRef(l);
        e.metadataHistory.push({ displayName: data.string(32), metadataURI: data.string(64), ...eventRef(l) });
      } else if (topic === TOPIC.collectorMetadataUpdated) {
        collectorEntry(topicAddress(l.topics[1])).metadataHistory.push({ displayName: data.string(0), metadataURI: data.string(32), ...eventRef(l) });
      } else if (topic === TOPIC.collectorListingUpdated) {
        collectorEntry(topicAddress(l.topics[1])).listingHistory.push({ listed: data.bool(0), ...eventRef(l) });
      }
    } else if (source === CONFIG.factory.toLowerCase()) {
      if (topic === TOPIC.artworkCreated) {
        artworkEntry(topicAddress(l.topics[1])).creation = { creator: topicAddress(l.topics[2]), ...eventRef(l) };
      }
    } else if (topic === TOPIC.artworkListingUpdated) {
      artworkEntry(l.address).listingHistory.push({ listed: data.bool(0), changedBy: topicAddress(l.topics[2]), ...eventRef(l) });
    } else if (topic === TOPIC.transfer && l.topics.length === 4) {
      transfers.push({ contract: checksum(l.address), from: topicAddress(l.topics[1]), to: topicAddress(l.topics[2]), tokenId: Number(BigInt(l.topics[3])), ...eventRef(l) });
    }
  }

  const collectors = collectorAddresses.map((address, i) => {
    const raw = new Abi(stateReplies[artworkCount * 4 + i]);
    const base = raw.number(0); // offset of the returned tuple
    const ev = collectorEvents.get(address.toLowerCase()) || { registration: null, metadataHistory: [], listingHistory: [] };
    const displayName = raw.string(base + 32, base);
    return {
      address,
      did: raw.string(base, base),
      displayName,
      metadataURI: raw.string(base + 64, base),
      registered: raw.bool(base + 96),
      listed: raw.bool(base + 128),
      region: /\balice\b/i.test(displayName) ? 'China GBA' : /\bbob\b/i.test(displayName) ? 'Hong Kong' : null,
      registration: ev.registration,
      metadataHistory: ev.metadataHistory,
      listingHistory: ev.listingHistory
    };
  });

  const artworks = artworkAddresses.map((address, i) => {
    const [metaHex, didHex, ownerHex, listedHex] = stateReplies.slice(i * 4, i * 4 + 4);
    const meta = new Abi(metaHex);
    const base = meta.number(0);
    const ev = artworkEvents.get(address.toLowerCase()) || { creation: null, listingHistory: [] };
    const own = transfers.filter(t => t.contract.toLowerCase() === address.toLowerCase());
    return {
      contract: address,
      tokenId: 1,
      artworkId: meta.string(base, base),
      title: meta.string(base + 32, base),
      artist: meta.string(base + 64, base),
      imageURI: meta.string(base + 96, base),
      contentHash: meta.string(base + 128, base),
      creator: meta.address(base + 160),
      did: new Abi(didHex).string(0),
      owner: new Abi(ownerHex).address(0),
      listed: new Abi(listedHex).bool(0),
      creation: ev.creation,
      listingHistory: ev.listingHistory,
      transfers: own.filter(t => t.from !== ZERO)
    };
  });

  const sales = transfers.filter(t => t.from !== ZERO).reverse(); // newest first, mints excluded
  log(`read ${artworks.length} artworks, ${collectors.length} collectors, ${sales.length} transfers at block ${latestBlock} in ${Date.now() - started} ms`);
  return { chainId, latestBlock, readAt: new Date().toISOString(), artworks, collectors, transfers: sales };
}

/* ---------------- lookups and presentation ---------------- */

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const isAddress = v => /^0x[0-9a-fA-F]{40}$/.test(String(v || '').trim());
const link = hash => hash ? EXPLORER + encodeURIComponent(hash) : null;
const txRef = ref => ref ? { txHash: ref.txHash, explorer: link(ref.txHash), block: ref.block, time: ref.time } : null;

// an 0x address, or a word from a collector's display name ("alice", "bob")
function resolveParty(snap, value, name) {
  const text = String(value || '').trim();
  if (isAddress(text)) return checksum(text);
  const word = new RegExp('\\b' + text.replace(/[^\w]/g, '') + '\\b', 'i');
  const matches = text ? snap.collectors.filter(c => word.test(c.displayName)) : [];
  if (matches.length === 1) return matches[0].address;
  throw new Error(`${name} must be a 0x address or the name of exactly one registered collector (${snap.collectors.map(c => c.displayName).join(', ') || 'none registered'}); got "${text}".`);
}

function who(snap, address) {
  const c = snap.collectors.find(x => sameAddress(x.address, address));
  return c ? `${c.displayName}${c.region ? ' (' + c.region + ')' : ''}` : address;
}

function findArtwork(snap, ref) {
  const text = String(ref || '').trim();
  if (!text) throw new Error('Name the artwork by its artworkId, contract address, or exact title.');
  const exact = snap.artworks.filter(a => a.artworkId === text || sameAddress(a.contract, text) || a.did.toLowerCase() === text.toLowerCase());
  if (exact.length) return exact[0];
  const byTitle = snap.artworks.filter(a => a.title.toLowerCase() === text.toLowerCase());
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) {
    // re-registered works share a title; prefer the single listed record
    const listed = byTitle.filter(a => a.listed);
    if (listed.length === 1) return listed[0];
    throw new Error(`Several artworks are titled "${text}": ${byTitle.map(a => `${a.artworkId} (${a.contract}, ${a.listed ? 'listed' : 'unlisted'})`).join('; ')}. Pass the artworkId or contract instead.`);
  }
  const known = snap.artworks.map(a => `"${a.title}" [${a.artworkId}]`).join(', ');
  throw new Error(`No artwork matches "${text}". Known artworks: ${known || 'none'}.`);
}

function summary(snap, a) {
  return {
    title: a.title,
    artist: a.artist,
    artworkId: a.artworkId,
    contract: a.contract,
    did: a.did,
    owner: a.owner,
    ownerName: who(snap, a.owner),
    listed: a.listed
  };
}

function transferView(snap, t) {
  const art = snap.artworks.find(a => sameAddress(a.contract, t.contract));
  return {
    artwork: art ? art.title : t.contract,
    artworkId: art ? art.artworkId : null,
    contract: t.contract,
    from: t.from, fromName: who(snap, t.from),
    to: t.to, toName: who(snap, t.to),
    time: t.time, block: t.block,
    txHash: t.txHash, explorer: link(t.txHash)
  };
}

function collectorView(c, detailed) {
  const base = {
    displayName: c.displayName,
    region: c.region,
    address: c.address,
    did: c.did,
    registered: c.registered,
    listed: c.listed
  };
  if (!detailed) return base;
  return Object.assign(base, {
    metadataURI: c.metadataURI || null,
    registration: txRef(c.registration),
    metadataHistory: c.metadataHistory.map(m => ({ displayName: m.displayName, metadataURI: m.metadataURI || null, ...txRef(m) })),
    listingHistory: c.listingHistory.map(m => ({ listed: m.listed, ...txRef(m) }))
  });
}

/* ---------------- tools ---------------- */

const REFRESH = { type: 'boolean', description: `Bypass the ${Math.round(CACHE_MS / 1000)} s cache and re-read the chain.` };
const ARTWORK_REF = { type: 'string', description: 'The artworkId (e.g. from search_artworks), the artwork\'s ERC-721 contract address, its did:art:artwork DID, or its exact title.' };
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const TOOLS = [
  {
    name: 'registry_summary',
    description: 'Overview of the ArtID Registry on qBESU: how many artworks (and how many are listed), collectors and ownership transfers there are, the chain ID, latest block and contract addresses. Always reads fresh chain data.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const s = await snapshot(true);
      return {
        chainId: s.chainId,
        latestBlock: s.latestBlock,
        readAt: s.readAt,
        artworks: s.artworks.length,
        listedArtworks: s.artworks.filter(a => a.listed).length,
        unlistedArtworks: s.artworks.filter(a => !a.listed).length,
        collectors: s.collectors.length,
        listedCollectors: s.collectors.filter(c => c.listed).length,
        transfers: s.transfers.length,
        contracts: { collectorRegistry: CONFIG.registry, artworkFactory: CONFIG.factory },
        rpc: CONFIG.rpcUrl
      };
    }
  },
  {
    name: 'search_artworks',
    description: 'Search the ArtID Registry of artworks by text (title, artist or artworkId) and/or current owner address. Unlisted artworks are excluded unless includeUnlisted is true; they are paused by their owner and cannot be transferred, and older versions of re-registered works are usually unlisted.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive text matched against title, artist and artworkId.' },
        owner: { type: 'string', description: 'Only artworks currently owned by this collector: a 0x address or a registered name such as "alice" or "bob".' },
        includeUnlisted: { type: 'boolean', description: 'Include unlisted records. Default false.' },
        refresh: REFRESH
      }
    },
    run: async args => {
      const s = await snapshot(args.refresh);
      const owner = args.owner ? resolveParty(s, args.owner, 'owner') : null;
      const q = String(args.query || '').trim().toLowerCase();
      const hits = s.artworks.filter(a =>
        (args.includeUnlisted || a.listed) &&
        (!owner || sameAddress(a.owner, owner)) &&
        (!q || [a.title, a.artist, a.artworkId].some(v => v.toLowerCase().includes(q))));
      const hiddenUnlisted = args.includeUnlisted ? 0 : s.artworks.filter(a => !a.listed &&
        (!owner || sameAddress(a.owner, owner)) &&
        (!q || [a.title, a.artist, a.artworkId].some(v => v.toLowerCase().includes(q)))).length;
      return { total: hits.length, hiddenUnlisted, artworks: hits.map(a => summary(s, a)) };
    }
  },
  {
    name: 'get_artwork',
    description: 'Full provenance for one artwork: IDs and DID, title, artist, creator, current owner, listing status, image URI and content hash, plus the creation, listing-change and transfer transactions with block times and qBESU explorer links.',
    inputSchema: { type: 'object', properties: { artwork: ARTWORK_REF, refresh: REFRESH }, required: ['artwork'] },
    run: async args => {
      const s = await snapshot(args.refresh);
      const a = findArtwork(s, args.artwork);
      const latestTransfer = a.transfers[a.transfers.length - 1];
      const latestListing = a.listingHistory[a.listingHistory.length - 1];
      return Object.assign(summary(s, a), {
        tokenId: a.tokenId,
        creator: a.creator,
        creatorName: who(s, a.creator),
        imageURI: a.imageURI || null,
        contentHash: a.contentHash || null,
        creation: txRef(a.creation),
        latestListingChange: latestListing ? { listed: latestListing.listed, changedBy: latestListing.changedBy, ...txRef(latestListing) } : null,
        latestTransfer: latestTransfer ? transferView(s, latestTransfer) : null,
        ownershipChain: [a.creator, ...a.transfers.map(t => t.to)].map(addr => ({ address: addr, name: who(s, addr) })),
        transfers: a.transfers.slice().reverse().map(t => transferView(s, t)),
        listingHistory: a.listingHistory.map(l => ({ listed: l.listed, changedBy: l.changedBy, ...txRef(l) }))
      });
    }
  },
  {
    name: 'list_collectors',
    description: 'List collectors in the ArtID collector registry with display name, region (Alice = China GBA, Bob = Hong Kong), address, DID and listing status. Unlisted collectors cannot send, receive or register artworks and are excluded unless includeUnlisted is true.',
    inputSchema: {
      type: 'object',
      properties: { includeUnlisted: { type: 'boolean', description: 'Include unlisted collectors. Default false.' }, refresh: REFRESH }
    },
    run: async args => {
      const s = await snapshot(args.refresh);
      const list = s.collectors.filter(c => args.includeUnlisted || c.listed);
      return { total: list.length, hiddenUnlisted: s.collectors.length - list.length, collectors: list.map(c => collectorView(c, false)) };
    }
  },
  {
    name: 'get_collector',
    description: 'One collector\'s registry record: DID, display name, region, metadata URI, registered/listed status, registration and profile-history transactions, plus the artworks they currently own and created.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'The collector\'s 0x wallet address, or a registered name such as "alice" or "bob".' }, refresh: REFRESH },
      required: ['address']
    },
    run: async args => {
      const s = await snapshot(args.refresh);
      const address = resolveParty(s, args.address, 'address');
      const c = s.collectors.find(x => sameAddress(x.address, address));
      const owns = s.artworks.filter(a => sameAddress(a.owner, address)).map(a => summary(s, a));
      const created = s.artworks.filter(a => sameAddress(a.creator, address)).map(a => summary(s, a));
      if (!c) return { address, registered: false, listed: false, note: 'This address is not in the ArtID collector registry, so it cannot receive, send or register artworks.', owns, created };
      return Object.assign(collectorView(c, true), { owns, created });
    }
  },
  {
    name: 'get_ownership_history',
    description: 'Artwork ownership transfers (sales), newest first, with block times and explorer links. Mints at registration are not included (see get_artwork for creation). Optionally filtered to one artwork.',
    inputSchema: {
      type: 'object',
      properties: {
        artwork: ARTWORK_REF,
        limit: { type: 'number', minimum: 1, maximum: 200, description: 'Default 20.' },
        refresh: REFRESH
      }
    },
    run: async args => {
      const s = await snapshot(args.refresh);
      const art = args.artwork ? findArtwork(s, args.artwork) : null;
      const all = s.transfers.filter(t => !art || sameAddress(t.contract, art.contract));
      const limit = Math.max(1, Math.min(200, Math.round(Number(args.limit) || 20)));
      return { total: all.length, shown: Math.min(limit, all.length), transfers: all.slice(0, limit).map(t => transferView(s, t)) };
    }
  },
  {
    name: 'verify_ownership',
    description: 'Check whether an address currently owns an artwork, and whether the contract rules would let that address send it (if it is the owner) or receive it (if not) right now: the artwork must be listed and both parties registered and listed collectors. Read-only; nothing is transferred.',
    inputSchema: {
      type: 'object',
      properties: {
        artwork: ARTWORK_REF,
        address: { type: 'string', description: 'The 0x address to check, or a registered collector name such as "alice" or "bob".' },
        refresh: REFRESH
      },
      required: ['artwork', 'address']
    },
    run: async args => {
      const s = await snapshot(args.refresh);
      const art = findArtwork(s, args.artwork);
      const address = resolveParty(s, args.address, 'address');
      const owns = sameAddress(art.owner, address);
      const status = addr => s.collectors.find(c => sameAddress(c.address, addr)) || { registered: false, listed: false };
      const party = status(address);
      const owner = status(art.owner);
      // mirrors ArtIDArtwork._update: sender listed, receiver registered + listed, artwork listed
      const reasons = [];
      if (!art.listed) reasons.push('the artwork is unlisted (its owner must list it again)');
      if (owns) {
        if (!party.listed) reasons.push('the owner is not a listed collector ("Sender is unlisted")');
      } else {
        if (!party.registered) reasons.push('the address is not a registered collector ("Receiver is not a registered collector")');
        else if (!party.listed) reasons.push('the address is an unlisted collector ("Receiver is unlisted")');
        if (!owner.listed) reasons.push('the current owner is unlisted ("Sender is unlisted")');
      }
      const direction = owns ? 'send' : 'receive';
      return {
        artwork: summary(s, art),
        address,
        addressName: who(s, address),
        ownsArtwork: owns,
        currentOwner: art.owner,
        currentOwnerName: who(s, art.owner),
        addressRegistered: party.registered,
        addressListed: party.listed,
        transferDirection: direction,
        transferAllowed: reasons.length === 0,
        reason: reasons.length
          ? `A transfer ${owns ? 'from' : 'to'} this address is blocked: ${reasons.join('; ')}.`
          : owns
            ? 'The address owns this listed artwork and is a listed collector, so it can transfer it to any registered, listed collector.'
            : 'The artwork is listed and both the current owner and this address are listed collectors, so the owner can transfer it to this address.',
        latestTransfer: art.transfers.length ? transferView(s, art.transfers[art.transfers.length - 1]) : null,
        asOfBlock: s.latestBlock
      };
    }
  }
];

for (const tool of TOOLS) tool.annotations = { title: tool.name.replace(/_/g, ' '), ...READ_ONLY };

async function callTool(name, args) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool "${name}". Available: ${TOOLS.map(t => t.name).join(', ')}.` }], isError: true };
  try {
    const result = await tool.run(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (error) {
    log(name, 'failed:', error.message);
    return { content: [{ type: 'text', text: `${name} failed: ${error.message}` }], isError: true };
  }
}

/* ---------------- MCP over stdio ---------------- */

const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(message) {
  const { id, method, params } = message;
  if (id === undefined) return; // notifications need no answer
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'art-id-registry', version: '1.0.0' },
        instructions: 'Read-only view of the public ArtID Registry on qBESU: artworks (one ERC-721 contract per work, token #1), collectors and ownership transfers. No login or PIN is needed and nothing is ever signed. Results are cached for about 30 s; pass refresh: true for fresh data. To act (log in, sell, buy, register, list/unlist) use the artid-wallet server.'
      });
    } else if (method === 'ping') {
      reply(id, {});
    } else if (method === 'tools/list') {
      reply(id, { tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
    } else if (method === 'tools/call') {
      log('call', params?.name);
      reply(id, await callTool(params?.name, params?.arguments));
    } else {
      fail(id, -32601, 'Method not found: ' + method);
    }
  } catch (error) {
    fail(id, -32603, error.message);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try { handle(JSON.parse(line)); } catch { fail(null, -32700, 'Parse error'); }
    }
  }
});
process.stdin.on('end', () => process.exit(0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
