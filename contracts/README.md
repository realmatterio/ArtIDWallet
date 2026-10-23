# ArtID smart contracts

## Contract overview

- **`ArtIDCollectorRegistry`** stores each collector record by wallet address.
  Its DID is `did:art:collector:<EOA>`. New collectors are listed by default;
  each collector can update metadata or list/unlist their own record. The
  registry exposes collector enumeration for the browser directory.
- **`ArtIDFactory`** accepts artwork creation from registered, listed
  collectors, rejects duplicate artwork IDs, deploys one `ArtIDArtwork`
  ERC-721 contract per artwork, and makes contracts discoverable with
  `artworkCount()` and `artworkAt(index)`.
- **`ArtIDArtwork`** stores an artwork ID, title, artist, image URI, content
  hash, and creator. It mints token ID `1` to its creator and starts listed.
  Its DID is `did:art:artwork:<ERC-721 contract address>`. The current owner
  controls listing; transfers require a listed artwork and a registered,
  listed recipient.

`artworkId` is a separate application identifier. The demo accepts
`did:art:artwork:<Keccak-256 of the exact title>` as an example. This is
distinct from the address-derived DID returned by `artworkDid()`. The demo's
content hash is Keccak-256 of the supplied image URL, not a hash of image
bytes.

## Using ArtIDWallet

1. The v2 contracts are deployed and their addresses and deployment blocks
   are configured in `artid-config.js`. See
   [`ADDRESS.md`](./ADDRESS.md) for the deployed contract addresses,
   deployment transaction hashes, qBESU endpoint, and known demo wallet
   addresses. Do not switch the browser client to immutable v1 contracts;
   they do not support listing controls.
2. Open `resale.html` or its GitHub Pages site. The public registry loads
   from qBESU on page load and can be refreshed without unlocking a wallet.
   Unlock Artist Alice and Collector Bob separately only for wallet actions.
   `4321` is a placeholder hint only and is not submitted automatically.
3. Open an unlocked wallet and register that collector if needed. Artists are
   collectors too, so Artist Alice receives a collector DID.
4. To create artwork data, enter the ID, title, artist, image URI, and content
   hash. Preview it, choose an unlocked registered and listed collector, then
   submit. The factory deploys the ERC-721 ID Token contract and mints token
   `1` to that collector.
5. **Art ID Registry** displays artwork and collector records read from qBESU.
   Collectors control their own listing; the current artwork owner controls
   the artwork listing. Unlisted collectors cannot create or receive records;
   unlisted artworks cannot be transferred.
6. Resale payment remains a local simulation and sends no payment transaction.
   Artist Alice signs the ERC-721 ID Token transfer to Collector Bob. The
   displayed owner changes only after qBESU confirms the transfer.

The public registry displays data stored on qBESU. Collector profile metadata
URIs are displayed but their off-chain JSON contents are not fetched. Artwork
records display the stored creator and content hash, but the current artwork
contract has no description or artwork metadata-URI field; refreshing cannot
populate those fields unless the contract schema or application is extended.

The static browser app uses the configured existing qBESU and ICCHSM proxy
functions; it does not run a local ArtID server. Use disposable demo wallets
only. PIN handling and proxy security are demo-only and are not production
authentication.

## Contract function reference

### `ArtIDCollectorRegistry`

| Function / event | Purpose |
|---|---|
| `register(displayName, metadataURI)` | Registers the caller's EOA, derives its collector DID, stores metadata, defaults the record to listed, and emits `CollectorRegistered`. |
| `updateMetadata(displayName, metadataURI)` | Updates the caller's own registered metadata and emits `CollectorMetadataUpdated`. |
| `setListed(listed)` | Lists or unlists the caller's own collector record and emits `CollectorListingUpdated`. |
| `getCollector(account)` | Returns DID, display name, metadata URI, registration state, and listing state. |
| `isRegistered(account)` / `isListed(account)` | Read the caller address's registration or listing state. |
| `collectorCount()` / `collectorAt(index)` | Enumerate registered collector addresses for the directory. |
| `collectorDid(account)` | Derives `did:art:collector:<EOA>` without changing state. |
| `CollectorRegistered(collector, did, displayName, metadataURI)` | Registration event, including the initial metadata values. |
| `CollectorMetadataUpdated(collector, displayName, metadataURI)` | Metadata update event, including the new values. |
| `CollectorListingUpdated(collector, listed)` | Collector listing state change event. |

### `ArtIDFactory`

| Function / event | Purpose |
|---|---|
| `createArtwork(artworkId, title, artist, imageURI, contentHash)` | Requires a registered, listed caller, non-empty ID/title, and unused artwork ID. Deploys an `ArtIDArtwork`, mints token `1`, catalogs the contract, and emits `ArtworkCreated`. |
| `artworkCount()` / `artworkAt(index)` | Read the artwork catalog size or contract address at a zero-based index. |
| `collectorRegistry()` | Public immutable getter for the collector registry used by the factory. |
| `ArtworkCreated(artworkContract, creator, tokenId, artworkId, did)` | Reports each newly created artwork contract and its DID. |

### `ArtIDArtwork` (one ERC-721 contract per artwork)

| Function / event | Purpose |
|---|---|
| `metadata()` | Returns artwork ID, title, artist, image URI, content hash, and creator. |
| `artworkDid()` | Returns `did:art:artwork:<this contract address>`. |
| `isListed()` | Returns current listing status; newly created records start listed. |
| `setListed(listed)` | Lists/unlists the artwork; only the current token owner may call it. Emits `ArtworkListingUpdated`. |
| `tokenURI(tokenId)` | Returns the stored image URI for an existing token; it does not generate a JSON document. |
| `ownerOf(tokenId)` | Returns the current owner; token ID `1` is the only initially minted token. |
| `safeTransferFrom(from, to, tokenId)` | Standard ERC-721 transfer subject to owner/approval, listed-artwork, and registered/listed-recipient checks. |
| `Transfer(from, to, tokenId)` | Standard ERC-721 mint/transfer event. Mint events use the zero address as `from`. |
| `ArtworkListingUpdated(artworkContract, listed, changedBy)` | Artwork listing state change event. |
| `collectorRegistry()` / `name()` / `symbol()` | Standard/public contract getters for registry, token name, and token symbol. |

The factory invokes the `ArtIDArtwork` constructor, which validates the
registry and creator, stores metadata, and mints token `1`. `_update` is an
internal OpenZeppelin ERC-721 hook, not a user-callable entry point; it
enforces registered/listed recipients and listed artwork on transfer.

## ArtIDWallet and network calls

| Wallet action | Contract calls |
|---|---|
| Connect a wallet | `getCollector(address)` for each unlocked ICCHSM address. |
| Refresh directories | `collectorCount()` / `collectorAt(index)`, `artworkCount()` / `artworkAt(index)`, record getters, and event history. |
| Register/update collector metadata | `register(displayName, metadataURI)` / `updateMetadata(displayName, metadataURI)` signed by that collector's ICCHSM slot. |
| List/unlist a collector | `setListed(listed)` signed by that collector's own slot. |
| Create artwork data | `createArtwork(...)` signed by a connected, registered, listed collector. |
| List/unlist artwork | `setListed(listed)` signed by the current owner's slot. |
| Transfer an ERC-721 ID Token | `safeTransferFrom(owner, recipient, 1)` signed by the current owner; both artwork and recipient must be listed. |
| Refresh transfer log | Reads ERC-721 `Transfer` events in bounded block ranges and fetches block timestamps. |

For writes, the browser resolves the ICCHSM slot EOA, checks the configured
qBESU chain ID, obtains the pending nonce, estimates gas, reads
`eth_gasPrice`, requests a signature from `walletSignTransaction`, and
broadcasts the signed transaction through the existing `besupost` function.
It polls `eth_getTransactionReceipt` before showing a write as confirmed.
Reads use `eth_call`; event history uses `eth_getLogs` and
`eth_getBlockByNumber`. `eth_chainId` and `eth_getTransactionCount` support
network and nonce checks. The `pay()` flow remains a local simulation and does
not call a payment contract.
