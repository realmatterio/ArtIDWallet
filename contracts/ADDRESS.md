# ArtIDWallet addresses

This file records the latest deployment documented for the ArtIDWallet v2
contracts. The network is qBESU (Hyperledger Besu), chain ID `1337`.
Deployment values are also recorded in [`artid-config.js`](../artid-config.js)
and [`INITIAL_DEPLOYMENT.md`](../INITIAL_DEPLOYMENT.md).

## qBESU connection

| Item | Value |
|---|---|
| Network | qBESU |
| Chain ID | `1337` (hex `0x539`) |
| JSON-RPC proxy | [besupost](https://us-central1-quantumatterwallet.cloudfunctions.net/besupost) |
| Transaction viewer | [Quantum Besu](https://quantumbesu.web.app/quantumbesu.html) |

The configured `besupost` URL is a JSON-RPC proxy, not a block explorer. The
transaction links below use the qBESU transaction viewer. Receipts can also be
queried through the JSON-RPC endpoint with `eth_getTransactionReceipt`.

## Deployed v2 contracts

The following deployments were verified on 2026-10-23. Both deployment
transactions succeeded.

| Contract | Address | Block | Deployment transaction |
|---|---|---:|---|
| `ArtIDCollectorRegistry` v2 | `0x8DFA147Aa00a4fe3a5895835eA78FeC7218aCA4a` | `611533` | [0x09196ce0…2211dbd](https://quantumbesu.web.app/quantumbesu.html?transaction=0x09196ce067168d44141439030327719b2c6034aeb3d91b4360764646e2211dbd) |
| `ArtIDFactory` v2 | `0x8c1171d964159907cbFf502E83B6718d7547771f` | `611534` | [0x1a66a283…22e032d](https://quantumbesu.web.app/quantumbesu.html?transaction=0x1a66a283c354cf4ab8b703a6b864702c626005b450f9f9c3c7d7f6fcc22e032d) |

The factory deploys a separate `ArtIDArtwork` ERC-721 contract for each
artwork created. A live public registry read on 2026-10-23 found these two
artwork contracts:

| Artwork | ERC-721 address | Artwork DID | Creation transaction |
|---|---|---|---|
| The Scream | `0x5718152da54B24dC5B866ca47DF6aaFC45994c14` | `did:art:artwork:0x5718152da54b24dc5b866ca47df6aafc45994c14` | [0xdff09a34…a3bc4e64](https://quantumbesu.web.app/quantumbesu.html?transaction=0xdff09a346548a4b1014ab48b318e0075dbd10c4158ce18be461ad623a3bc4e64) |
| The Great Wave | `0x0b46A64AcA5E8186e69BFC6F1C1C71Cd389F7C71` | `did:art:artwork:0x0b46a64aca5e8186e69bfc6f1c1c71cd389f7c71` | [0x6f059221…522b50b8e](https://quantumbesu.web.app/quantumbesu.html?transaction=0x6f059221f28e440a6de1d5b0507f16bd8202787449ceca2cc012750522b50b8e) |

The public app shortens displayed transaction hashes; query the factory's
`ArtworkCreated` logs or the qBESU transaction receipt for full values. The
Great Wave `contentHash` was empty in this live read. Query the factory's
`artworkAt(index)` for the current complete catalog. The chain is authoritative
if these notes become stale.

## Known demo EOAs

These are the demo addresses documented for the ICCHSM wallet slots. Verify
the slot mapping before submitting a transaction.

| Profile | ICCHSM slot | EOA |
|---|---:|---|
| Artist Alice | `53897301` | `0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7` |
| Collector Bob | `53897302` | `0xdd106493BAAc49828336d762AdA8a6031d286f06` |

EOA means externally owned account. Do not add private keys or PINs to this
file or any tracked file.
