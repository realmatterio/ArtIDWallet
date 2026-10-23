# ArtIDWallet static demo INITIAL deployment

## Architecture

```text
GitHub Pages
  resale.html, CSS, browser JavaScript, ethers.js CDN
        ├── qBESU JSON-RPC reads and broadcasts
        │     └── Existing besupost Firebase proxy
        └── ICCHSM wallet address and signing requests
              └── Existing walletReadAddress and walletSignTransaction functions

qBESU contracts
  ArtIDCollectorRegistry
  ArtIDFactory
  One ArtIDArtwork ERC-721 contract per artwork
```

ArtIDWallet is a static site; it has no local Node/Express server. The
`package.json` is used to compile, test, and deploy contracts. GitHub Pages
serves the UI without `node_modules`. Each wallet has its own PIN form and
in-memory PIN session. The `4321` placeholder is a hint only; the app does not
prefill or persist the PIN.

The existing resale `pay()` simulation remains browser-only and sends no
payment transaction. The current owner signs an ERC-721 ID Token transfer, and
the UI reports completion only after qBESU confirms the transaction and the
owner read is refreshed. The UI displays a pending indicator while waiting;
qBESU blocks may take about a minute.

## Existing proxy prerequisites

The static client reuses existing HTTPS functions. It does not deploy a new
ArtID API or alter the proxy source:

- qBESU JSON-RPC: `https://us-central1-quantumatterwallet.cloudfunctions.net/besupost`
- ICCHSM address lookup: `https://us-central1-ironcapmatter.cloudfunctions.net/walletReadAddress`
- ICCHSM transaction signing: `https://us-central1-ironcapmatter.cloudfunctions.net/walletSignTransaction`

Before use, verify that the endpoints are deployed, accept requests from the
GitHub Pages origin, and support the expected RPC and signing payloads. The
legacy endpoint and `mechanism=besu` parameter names are retained for API
compatibility; the application-facing network name is qBESU. A source tree
alone does not prove that these functions remain deployed.

## Wallet defaults and function calls

`4321` appeared as a legacy demo PIN hint and in commented examples. It is not
a verified credential for either live slot. Enter the PIN separately for each
wallet and use disposable demo slots.

| Setting | Default | Basis / caveat |
|---|---|---|
| Artist Alice slot | `53897301` | Existing demo profile; verify its live mapping |
| Collector Bob slot | `53897302` | Existing demo profile; verify its live mapping |
| `mechanism` | `besu` | Legacy ICCHSM/proxy compatibility parameter |
| qBESU chain ID | `1337` | Verify against the target node |
| qBESU RPC proxy | Existing `besupost` HTTPS function | Confirm endpoint availability |
| v2 collector registry | `0x8DFA147Aa00a4fe3a5895835eA78FeC7218aCA4a` | Deployed at block `611533` |
| v2 artwork factory | `0x8c1171d964159907cbFf502E83B6718d7547771f` | Deployed at block `611534` |
| Wallet PIN | None | Enter per wallet at runtime; not prefilled or persisted |

The browser client currently calls:

| Function / RPC method | Parameters or purpose |
|---|---|
| `walletReadAddress` | HTTPS GET with `slot`, `pin`, `mechanism=besu`; resolves each unlocked EOA |
| `walletSignTransaction` | HTTPS GET with slot, PIN, mechanism, unsigned transaction, nonce, gas, target, value, data, chain ID, and gas price |
| `eth_chainId` | Verifies the connected qBESU network |
| `eth_getTransactionCount` | Gets the pending transaction nonce |
| `eth_estimateGas` | Estimates gas for a contract call |
| `eth_gasPrice` | Gets the legacy gas price used to construct the signed transaction |
| `eth_call` | Reads collector records, collector/artwork catalogs, artwork metadata, listing state, and ownership |
| `eth_getLogs` | Reads collector metadata/listing events, artwork creation/listing events, and ERC-721 transfer events; queries are chunked into 500-block ranges |
| `eth_getBlockByNumber` | Resolves timestamps for transfer history |
| `eth_sendRawTransaction` | Broadcasts the ICCHSM-signed transaction |
| `eth_getTransactionReceipt` | Polls for transaction confirmation or failure |

ArtID does not show balances or call a payment contract. Other legacy wallet
methods are not used by this static client.

The service-side ICCHSM signer is not present in this repository. The client
passes the unsigned serialized Ethereum transaction in the
`hashedTransaction` parameter while also sending transaction fields. Verify
that format and signature behavior with a disposable test slot before relying
on writes; successful address lookup alone does not confirm signer
compatibility.

## A. Configure the static client

The v2 contracts are deployed. `artid-config.js` has been updated with the
current deployment values:

- Confirm `chainId` and the qBESU/ICCHSM HTTPS URLs.
- Confirm each ICCHSM slot maps to the intended wallet.
- The config contains `collectorRegistryAddress=0x8DFA147Aa00a4fe3a5895835eA78FeC7218aCA4a`
  and `collectorRegistryDeploymentBlock=611533`.
- The config contains `factoryAddress=0x8c1171d964159907cbFf502E83B6718d7547771f`
  and `artworkFactoryDeploymentBlock=611534`.

The v2 client requires these addresses and blocks. The old v1 addresses are
deliberately not configured because those immutable contracts have no listing
functions. The app starts with a fresh v2 registry and does not include the
legacy v1 records.

The client loads ethers.js from a pinned public CDN. The GitHub Pages workflow
publishes an explicit static-file allowlist and serves `resale.html` as both
`index.html` and `resale.html`.

## B. Compile, test, and deploy v2 contracts

From `QuantumSafeBlockchain/ArtIDWallet`:

```sh
npm ci
npm test
npm run build
```

Set `QBESU_RPC_URL`, `QBESU_CHAIN_ID`, and a dedicated
`DEPLOYER_PRIVATE_KEY` through an approved secret manager or ephemeral
environment. Legacy `BESU_RPC_URL` and `BESU_CHAIN_ID` are accepted for
compatibility. Never commit a deployer key. Check the chain ID and gas policy
before deployment.

Deploy the collector registry followed by the factory:

```sh
npm run deploy:qbesu
```

The script prints both addresses and deployment block numbers. The deployment
performed on 2026-10-23 was verified on chain ID `1337`:

| Contract | Address | Deployment block | Deployment transaction | Receipt |
|---|---|---:|---|---|
| `ArtIDCollectorRegistry` v2 | `0x8DFA147Aa00a4fe3a5895835eA78FeC7218aCA4a` | `611533` | `0x09196ce067168d44141439030327719b2c6034aeb3d91b4360764646e2211dbd` | Success |
| `ArtIDFactory` v2 | `0x8c1171d964159907cbFf502E83B6718d7547771f` | `611534` | `0x1a66a283c354cf4ab8b703a6b864702c626005b450f9f9c3c7d7f6fcc22e032d` | Success |

Post-deployment checks confirmed non-empty bytecode at both addresses, the
factory points to the new registry, and the new registry and factory each
reported zero records at initial deployment verification. This is historical
initial-state information, not the current registry contents. A live public
registry read on 2026-10-23 found two registered collectors and two artwork
contracts (`The Scream` and `The Great Wave`); see
[`contracts/ADDRESS.md`](./contracts/ADDRESS.md) for their addresses and
creation transactions. The Great Wave's on-chain content hash was empty in
that read. The factory creates and deploys a separate `ArtIDArtwork` contract
whenever `createArtwork(...)` is called. The four v2 config values above are
already set in `artid-config.js`.

## C. Seed Artist Alice, Collector Bob, and artwork records

The prepared values and unique artwork descriptions are in
[`deployment-seed.json`](./deployment-seed.json). This is a deployment
checklist/data manifest; it does not send transactions or automatically seed
the contracts.

| Profile | EOA to verify from ICCHSM | Collector metadata |
|---|---|---|
| Artist Alice | `0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7` | Contemporary digital artist known for vibrant color palettes and innovative visual storytelling. |
| Collector Bob | `0xdd106493BAAc49828336d762AdA8a6031d286f06` | Avid art collector focused on discovering and supporting emerging contemporary and digital artists. |

Artist Alice's ICCHSM slot was verified to return her supplied EOA.
Collector Bob's configured slot (`53897302`) returned
`0xdd106493BAAc49828336d762AdA8a6031d286f06`, not the previously supplied
`0x8a03Cd8Fdb225Fe1A74e94C3b6d193F3ABAE52D5`. The user chose to use the
address resolved from the live Bob slot; the derived DID and profile fields
below have been updated to match. Publish each collector profile JSON to a
stable HTTPS or IPFS location and use that URI as `metadataURI` when
registering; the manifest's `metadataURI` values are intentionally `null`
until hosted.

### Collector registration fields

In the wallet screen, enter the following values before selecting
**Register collector**. `register(displayName, metadataURI)` uses the connected
ICCHSM wallet as the EOA; do not enter an EOA into the display-name or
metadata field. The DID is derived by the contract.

| Wallet/profile | `displayName` | EOA expected from ICCHSM | Collector DID derived on-chain | `metadataURI` |
|---|---|---|---|---|
| Artist Alice (`alice`, slot `53897301`) | `Artist Alice` | `0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7` | `did:art:collector:0x29f780c62f75dccc7ff6f43f7e319e4da870a3c7` | Publish profile JSON and paste its HTTPS/IPFS URI; not yet assigned |
| Collector Bob (`bob`, slot `53897302`) | `Collector Bob` | `0xdd106493BAAc49828336d762AdA8a6031d286f06` | `did:art:collector:0xdd106493baac49828336d762ada8a6031d286f06` | Publish profile JSON and paste its HTTPS/IPFS URI; not yet assigned |

Use this profile JSON as the content to publish for each collector; fill in
`eoa` with the matching verified address and replace the URI placeholder after
hosting. The URI itself is entered as `metadataURI` in the registration form:

```json
{
  "name": "Artist Alice",
  "did": "did:art:collector:0x29f780c62f75dccc7ff6f43f7e319e4da870a3c7",
  "eoa": "0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7",
  "description": "A contemporary digital artist known for vibrant color palettes and innovative visual storytelling."
}
```

```json
{
  "name": "Collector Bob",
  "did": "did:art:collector:0xdd106493baac49828336d762ada8a6031d286f06",
  "eoa": "0xdd106493BAAc49828336d762AdA8a6031d286f06",
  "description": "An avid art collector who focuses on discovering and supporting emerging contemporary and digital artists."
}
```

The four artwork records are assigned to Artist Alice as creator. The
`artist` field preserves the historical attribution of the supplied image;
the on-chain `creator` is Artist Alice's EOA. Enter the exact values below in
the artwork form. The contract call is
`createArtwork(artworkId, title, artist, imageURI, contentHash)`; choose
**Create as Artist Alice** for each record:

| Field | The Scream | The Great Wave | The Starry Night | Sunflowers |
|---|---|---|---|---|
| `artworkId` | `did:art:artwork:0x1b0aced4cb055d2c85b7376a3d88f0ed33cc7e193813c882d828a0a6ab35c824` | `did:art:artwork:0x8383f525d848b12301488712585f1de6a7a0892432aadb1f47e2caa0bab43ef3` | `did:art:artwork:0x20a599aeef8b8a3ef4a320e7410106202950c114c2923adc609c168372ed7254` | `did:art:artwork:0x185ce5e69eba839de27403ae2648613f145a82a56d8583f41ee3b1b2ec6a0ffa` |
| `title` | `The Scream` | `The Great Wave` | `The Starry Night` | `Sunflowers` |
| `artist` | `Edvard Munch` | `Katsushika Hokusai` | `Vincent van Gogh` | `Vincent van Gogh` |
| `imageURI` | `https://raw.githubusercontent.com/shaheerfarid/QuantumatterWallet/refs/heads/main/images/art/scream.jpg` | `https://raw.githubusercontent.com/shaheerfarid/QuantumatterWallet/refs/heads/main/images/art/great-wave.jpg` | `https://raw.githubusercontent.com/shaheerfarid/QuantumatterWallet/refs/heads/main/images/art/starry-night.jpg` | `https://raw.githubusercontent.com/shaheerfarid/QuantumatterWallet/refs/heads/main/images/art/sunflowers.jpg` |
| `contentHash` | `0x6906a5e3155d71bc40ec879cfdb7608965107eb598ef7b416113bb51af735191` | `0x9b399eaf74ff678c075bd33e0978ceb0833c18c59b22831cbb04cc4fd9b8dd4f` | `0x14f14dcd189cd1c1af4501074e79ccd6797867cf5cd249533326409186ca1278` | `0x3b161e302d2ad3b9405c594b6fad690e5022b29828ea230ef4e8286222e12acc` |
| UI creator selection | `alice` | `alice` | `alice` | `alice` |
| `creator` EOA (resolved from Artist Alice's ICCHSM slot) | `0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7` | `0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7` | `0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7` | `0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7` |
| Off-chain `description` | An expressionist scene of a solitary figure beneath a turbulent sky, centered on vivid color, movement, and psychological intensity. | A towering blue wave curls above small boats, balancing the force of the sea against the distant, quiet outline of Mount Fuji. | A luminous night sky of sweeping blue forms and bright stars arches over a peaceful village and a dark, flame-like cypress. | A warm still life of sunflowers at different stages, using layered gold and ochre tones to give the arrangement a lively, tactile presence. |
| Artwork `metadataURI` | Not accepted by current `createArtwork`; publish JSON separately if needed | Not accepted by current `createArtwork`; publish JSON separately if needed | Not accepted by current `createArtwork`; publish JSON separately if needed | Not accepted by current `createArtwork`; publish JSON separately if needed |

The artwork descriptions are unique off-chain metadata prepared in
`deployment-seed.json`. Publish each artwork JSON to a stable HTTPS or IPFS
location if it needs an independently addressable URI. The current v2
`ArtIDArtwork` contract stores the artwork ID, title, artist, image URL, URL
hash, and creator; it has no description or artwork metadata-URI field.
Therefore, do not paste a description or artwork metadata URI into the current
creation form. Its `tokenURI()` returns the image URL. Collector profile
metadata URIs, by contrast, are stored in the collector registry.

After submitting each transaction, wait for qBESU confirmation and verify the
record in the Art ID Registry. The app will derive the address-based artwork
DID from each newly deployed ERC-721 contract address; this differs from the
title-hash `artworkId` above. Do not use the previously deployed v1 artwork
contracts as a substitute for these fresh v2 seed records.

## D. Legacy v1 deployment (historical; not used by the v2 app)

The immutable v1 contracts were deployed to chain ID `1337`:

| Contract | Address |
|---|---|
| `ArtIDCollectorRegistry` | `0xA19E380Ef6d16abCbeF7F76022c5f7Dde3625AF4` |
| `ArtIDFactory` | `0x6920E5C1EE055aBF431497F04F26296f176BC89D` |

Four artwork records were previously created on v1. They remain historical
chain data, are not imported into the clean v2 catalog, and are intentionally
omitted from the v2 app.

## E. Publish and verify

1. Enable GitHub Pages and configure its deployment environment if required.
   Publish the project root (or ensure the published artifact includes the
   root `index.html` and app assets). The root `index.html` redirects visitors
   to `resale.html` automatically.
2. Review `.github/workflows/artidwallet-pages.yml`; it publishes static
   assets only and does not deploy Firebase Functions.
3. Open the site over HTTPS. The public registry loads automatically from
   qBESU without requiring a wallet unlock; use **Refresh from qBESU** to
   load it again.
4. Unlock each test wallet separately only when performing wallet actions.
   The client resolves its EOA through `walletReadAddress` and reads qBESU
   through `besupost`.
5. Register a collector; create artwork data; toggle listing; then transfer a
   listed artwork to a registered, listed recipient. Wait for each receipt and
   verify the refreshed record and owner.

## Demo-only PIN behavior and production issues

The existing ICCHSM functions accept a PIN as a GET query parameter. The
browser sends it only for address lookup and signing and does not store it
persistently. URLs may still be exposed in browser/network history or proxy
and service logs. Use disposable test slots; never enter a production PIN.
This demo does not provide production-grade authentication, authorization,
signer assurances, or HSM isolation. The existing qBESU and ICCHSM proxies
may expose broad access; CORS is not authentication. Independently verify the
wallet signing API before using the app with valuable accounts.

## Acceptance checks

- [ ] GitHub Pages serves the static client without a local server.
- [ ] The client calls only the configured existing HTTPS proxy functions.
- [ ] PINs are entered separately, not prefilled or persisted, and cleared
      from memory on lock or page reload.
- [ ] Wallet EOAs resolve from the configured ICCHSM slots.
- [ ] Collector DID/metadata, artwork metadata, and ownership load from qBESU.
- [ ] Registration, metadata updates, artwork creation, listing changes, and
      transfers use ICCHSM-signed transactions.
- [ ] New collectors and artworks start listed; only collector owners can
      change collector listing, and only artwork owners can change artwork
      listing.
- [ ] Unlisted collectors cannot use wallet actions other than their own
      relisting control; unlisted artworks cannot transfer.
- [ ] Pending/confirmed/failed states are explicit and the UI waits for
      receipts before reflecting writes.
- [ ] Payment simulation remains local and sends no payment transaction.
