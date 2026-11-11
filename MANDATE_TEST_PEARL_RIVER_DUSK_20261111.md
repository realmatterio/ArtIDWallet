# Live qBESU mandate test: Pearl River Dusk

## Summary

On 11 November 2026, the Human Wallet created an on-chain transfer mandate
for Alice's artwork **Pearl River Dusk, 2026**, separately approved the
mandate contract for its ERC-721 token, and inspected the mandate in Agentic
Alice's wallet. Both transactions were confirmed on qBESU. **No artwork
transfer was executed and no payment was made.**

The test was explicitly limited to creating and approving a one-transfer
mandate for Collector Bob, expiring after approximately 24 hours, and
inspecting it in agent mode. The confirmation flow was exercised using the
already-unlocked principal wallet; the PIN was not recorded in this report.

## Network, wallets and artwork

| Item | Value |
|---|---|
| Network | qBESU, chain ID `1337` |
| JSON-RPC endpoint | [besupost](https://us-central1-quantumatterwallet.cloudfunctions.net/besupost) |
| Mandate contract | `0x124323D8e8f2C1Cf0F78fBc7244893d424e4475A` |
| Principal / Artist Alice | `0x29F780C62F75DCCc7fF6f43f7e319E4da870a3C7` |
| Recipient / Collector Bob | `0xdd106493BAAc49828336d762AdA8a6031d286f06` |
| Artwork | Pearl River Dusk, 2026 |
| Artwork contract | `0x16CE4a45FB28750FC868Bd92E8f3E377aa980a28` |
| Artwork ID | `did:art:artwork:0x7430caf466e686e1c154e1438e3a6ddebc491bf3ed253675b55dbf9a56d7d400` |
| ERC-721 token ID | `1` |

Before creating the mandate, live reads showed that Alice owned the artwork,
the artwork was listed, Bob was registered and listed, and the token had no
token-specific or operator-wide approval for the mandate contract. The next
mandate ID was `1`. Read-only `eth_call` simulations of creation and approval
succeeded; those simulations did not submit transactions.

## Mandate and transactions

| Field | Confirmed value |
|---|---|
| Mandate ID | `1` |
| Principal | Alice |
| Permitted recipient | Bob |
| Permitted artwork | Pearl River Dusk contract above |
| Maximum transfers | `1` |
| Remaining transfers at verification | `1` |
| Expiry | 12 November 2026, 23:13:00 UTC+8 (15:13:00 UTC) |
| Revoked at verification | No |

| Operation | Transaction hash | Block | Block time UTC | Receipt | Gas used |
|---|---|---:|---|---|---:|
| Create mandate | [0xfbca4dc7d42c5b53255a18139b1987de1f342b2bc7287283c06c3719ce2b110a](https://quantumbesu.web.app/quantumbesu.html?transaction=0xfbca4dc7d42c5b53255a18139b1987de1f342b2bc7287283c06c3719ce2b110a) | 639279 | 2026-11-11 15:14:00 | Success (`1`) | 125885 |
| Approve token | [0x8dfc4481f4ab6dec17060155fb529b87b7310d2fc1bd34a383a786eac2deef7b](https://quantumbesu.web.app/quantumbesu.html?transaction=0x8dfc4481f4ab6dec17060155fb529b87b7310d2fc1bd34a383a786eac2deef7b) | 639280 | 2026-11-11 15:15:00 | Success (`1`) | 48361 |

Alice was the sender of both transactions. The first targeted the mandate
contract; the second targeted the artwork contract.

## Test procedure and results

1. **Human wallet:** Alice opened her unlocked wallet, selected the human
   mandate controls, and entered the artwork contract, Bob's address, the
   expiry and a limit of one transfer.
2. **Create:** The creation confirmation was accepted. The wallet reported
   mandate `1` created after the transaction was confirmed.
3. **Inspect before approval:** The human wallet reported an active mandate,
   Alice as principal and owner, Bob as recipient, one remaining transfer,
   the artwork permitted, and the contract not yet approved.
4. **Approve:** Alice's wallet submitted the separate token-specific approval
   transaction for the mandate contract; its receipt succeeded.
5. **Agent wallet:** The mode was switched, the user unlocked Agentic Alice,
   and the Artist role was selected. Inspecting mandate `1` with the artwork
   contract displayed Alice, Bob, the expiry, one remaining transfer,
   permitted artwork, Alice as owner and approval present.
6. **Independent chain verification:** At block `639282`, the mandate was not
   revoked, the artwork was permitted and listed, the token's approved
   address was the mandate contract, and Alice remained the token owner.
   Both transaction receipts had status `1`.

**Result:** PASS for the authorized live creation, token approval and
agent-mode inspection. Transfer execution, payment and ownership change were
intentionally not tested. No AP2 mandate was created.

## Follow-up and safety

- The mandate expires at the time above, but the **ERC-721 approval persists**
  until the token is transferred or the approval is separately revoked.
  Revoking the mandate alone does not remove that approval.
- To remove the permission when no longer needed, use the Human Wallet's
  **Revoke mandate** and **Revoke artwork approval** actions as appropriate;
  each is a separate on-chain action. Check for any operator-wide approvals
  separately.
- The mandate allows one transfer to Bob while valid; payment and price are
  not enforced. Direct transfers outside the mandate remain possible.
- The verification above is a snapshot at block `639282`, not a guarantee of
  current ownership or authorization. Re-read the chain before any action.
- The human and agent modes use the principal's wallet; this test does not
  establish an independent agent key or AP2 compliance. See
  [Human and Agent Operation Flow](./HUMAN_AGENT_OPERATION_FLOW.md) and
  [contract reference](./contracts/README.md).
