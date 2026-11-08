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
2. Open `human-wallet.html` or its GitHub Pages site. The public registry loads
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

Registry history is read from the configured deployment blocks in 500-block
ranges, with at most eight log queries in flight across the client. Results are
assembled in block-range order. History is scanned again on refresh, so loading
time and the number of queries grow as the chain and artwork catalog grow.
An RPC query failure fails the refresh rather than displaying incomplete history.
Run the browser-client range and concurrency regression tests with
`node --test tests/artid-chain-logs.test.cjs` from the project root.

The static browser app uses the configured existing qBESU and ICCHSM proxy
functions; it does not run a local ArtID server. Use disposable demo wallets
only. PIN handling and proxy security are demo-only and are not production
authentication.

The wallets can create and use on-chain transfer mandates as described below.
No AP2 integration is implemented. Agent transactions still require human
approval. The wallets do not perform KYC or AML verification.

## Transfer mandate contract

`ArtIDTransferMandates` is a separate contract deployed on qBESU. Each mandate fixes
one recipient, up to 100 explicitly listed artwork contract addresses, an expiry
timestamp, and a maximum number of transfers. It transfers token ID `1` only,
matching the existing `ArtIDArtwork` contracts. The principal must own each
token and separately approve the mandate contract on that token. The artwork
contract still enforces the registered/listed collector and artwork rules.
Mandates may be revoked; failed transfers do not consume the limit. Revoking a
mandate does not revoke ERC-721 approvals: owners should revoke unused approvals
on the artwork contracts separately.

The current human and agent share the same ICCHSM key. Only the principal's
address can call `executeTransfer`; the contract cannot distinguish an agent
from the human or prevent direct transfers outside the mandate contract.
Independent mandates can each have their own limits, so the limits are not
aggregate spending or transfer caps. The contract does not authenticate
artwork addresses against the factory: the principal must check each address
before approving it. It does not enforce payment, price, AP2 messages, KYC, AML,
or a unique agent identity. It has not been independently audited.

In the Human Wallet, unlock the principal, enter a recipient, owned artwork
addresses, expiry and transfer limit, and select **Authorize Agentic Work**.
Keep the resulting mandate ID: the wallets do not enumerate mandates. Inspect
the mandate using that ID and each artwork address, then separately approve each
artwork's token #1. Token approval replaces any existing token-specific approval.
The principal can revoke a mandate and separately revoke each token approval;
revoking a token-specific approval does not revoke operator-wide approvals.

In the Agent Wallet, unlock the same principal, enter the mandate ID and artwork
address on Wallet Mandate, inspect the on-chain details, and select **Execute
mandated transfer**. The user must confirm the displayed transfer before signing.
WebMCP also offers `inspect_mandate` and `execute_mandated_transfer`; the latter
requires the same on-screen confirmation. The existing direct resale action is
separate and does not use or enforce a mandate. Simulated price and payment are
informational only.

For a future deployment, securely configure the existing Hardhat qBESU environment
with `QBESU_RPC_URL` (or `BESU_RPC_URL`) and the existing deployer's key in
`DEPLOYER_PRIVATE_KEY`; never put keys in tracked files. Run
`npx hardhat run scripts/deploy-mandates.js --network qbesu` only after review
and explicit deployment approval. The script checks chain ID `1337` and requires
the configured signer address to match the recorded registry deployer
`0xecc51175adaf8852b0494c53fc8c29cbfcaf7d0d`. A matching chain ID does not
authenticate the RPC endpoint; independently verify the endpoint and signer.
The deployment uses the Hardhat key-based signer, not the ICCHSM signing proxy.
Record the confirmed contract address, block, and transaction and update the
configured UI address if deploying again. This script deploys only the mandate contract; it does not redeploy the
collector registry or artwork factory.

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
