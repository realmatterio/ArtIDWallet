# Human and Agent Operation Flow

## DID:ART ID Registry (GBA-HK)

This document describes a **proposed production flow** for an artist, a
collector and an agent, based on the
[production presentation](./PRODUCTION_PRESENTATION.md). It also explains
how the current demo differs. The production controls described below are
design goals, not features already established by the deployed contracts.

## 1. Participants

| Participant | Responsibility |
|---|---|
| Human principal | The artist or collector who remains the customer of record, controls the wallet and authorizes agent activity. |
| Licensed VASP/VATP | Performs customer due diligence, sanctions screening, Travel Rule and applicable regulatory reporting. |
| Agent | Assists the principal within an authorized mandate and an active agent session. It is not the customer of record. |
| Collector | The intended recipient of an artwork ID token; this may be another human principal. |
| Registry and settlement services | Record identity assertions, artwork ownership, mandate evidence and settlement outcomes, subject to the selected production design. |
| ICCHSM service | Provides key-management and transaction-signing services through an authenticated interface. |

Example: Artist Alice in the Greater Bay Area is the principal and artwork
owner. Collector Bob in Hong Kong is the intended recipient. Alice asks her
agent to prepare and execute a transfer to Bob.

## 2. Flow at a glance

```text
HUMAN                         SYSTEM / LICENSED INSTITUTION       AGENT
  |                                       |                        |
  |-- Complete eKYC and CDD ------------->|                        |
  |<-- Credential and Tier-3 wallet CA ---|                        |
  |-- Register artwork and define ------->|                        |
  |   open mandate                        |                        |
  |                                       |-- Issue Tier-4 ------->|
  |                                       |   session if eligible  |
  |                                       |<-- Prepare transaction-|
  |                                       |    and closed mandate  |
  |                                       |-- Check mandate, ------|
  |                                       |   session and AML      |
  |<-- Step-up if required ---------------|                        |
  |-- Approve or decline ---------------->|                        |
  |                                       |-- Pass: release ------>|
  |                                       |   or fail: stop        |
  |<-- Settlement outcome and evidence --|------------------------|
```

In the proposed production design, the agent has its own short-lived
session credential. The deployed demo instead uses the principal's shared
key and requires an on-screen human confirmation for agent-initiated writes.

## 3. Human flow: identity and wallet setup

1. **Start onboarding.** Alice selects a licensed institution serving the
   applicable jurisdictions and submits the information required for eKYC.
2. **Complete due diligence.** The licensed institution performs its
   applicable customer due diligence, identity verification, sanctions and
   PEP checks, risk assessment and source-of-funds review.
3. **Issue the identity credential.** After successful checks, the licensed
   institution issues an appropriate verifiable credential. The wallet CA
   issues the proposed Tier-3 wallet certificate bound to Alice's DID,
   subject to the production trust and issuance policy.
4. **Activate the wallet.** Alice accesses her wallet using an approved
   human-controlled trusted surface. The ICCHSM service resolves the wallet
   address and handles authorized signing requests.
5. **Register an identity assertion.** The registry records the permitted
   DID/certificate assertion and its status. The production design should
   keep full identity records with the licensed institution rather than
   placing them on-chain.
6. **Check the recipient.** Bob completes the required onboarding through
   an appropriate licensed institution and has an active, eligible collector
   identity. Alice verifies the intended recipient before authorizing a
   transfer.

**If onboarding fails or a credential is inactive:** do not issue or use an
agent session or release a transfer. Route the case to the responsible
institution for review.

## 4. Human flow: register artwork and authorize the agent

1. **Create the artwork record.** Alice enters the artwork identifier,
   title, artist and supported metadata. The factory creates an artwork
   contract and mints its ID token to Alice's wallet.
2. **Review the record.** Alice checks the artwork address, collector
   identity, listing status and ownership on the registry.
3. **Define an open mandate.** On a trusted human-controlled surface, Alice
   specifies the intended policy envelope, such as:
   - Approved recipient or recipient class and artwork scope.
   - Purpose, expiry and transfer count.
   - Amount, payment currency and aggregate or velocity limits, if supported
     by the production implementation.
   - Conditions requiring human step-up or explicit confirmation.
4. **Sign the authorization.** Alice reviews and signs the open mandate.
   Record the mandate reference, scope, validity period and signing evidence.
5. **Approve artwork access.** Where required by the settlement design, Alice
   separately authorizes the settlement contract for the relevant tokens.
   She reviews any existing token or operator approvals before changing them.
6. **Start an agent session.** The proposed session service checks the active
   principal certificate and mandate, then issues an appropriately scoped,
   short-lived Tier-4 agent session credential.
7. **Provide a task.** Alice asks the agent to prepare a transfer within the
   open mandate. She does not give the agent her PIN or private key.

An open mandate is an authorization envelope, not evidence that a transfer,
payment or AML check has already succeeded.

## 5. Agent flow: prepare and validate

1. **Present session authority.** The agent presents its active Tier-4
   session credential and the open mandate reference to the policy service.
2. **Inspect current state.** The agent reads the artwork identifier,
   owner, listing and token-approval status; the recipient's eligibility;
   and the mandate's scope, expiry and remaining limits.
3. **Prepare the transaction.** The agent proposes the specific artwork,
   recipient and, where payment is supported, amount and settlement terms.
4. **Create closed-mandate evidence.** For an AP2 payment, the agent prepares
   and signs the specific closed Checkout and Payment Mandates only if the
   production design permits that action within the corresponding
   human-authorized open mandates. Artwork-transfer authorization requires
   additional application-specific evidence and enforcement.
5. **Submit for policy evaluation.** The policy service validates the
   credential chain, session status, principal, mandate signature and scope,
   current ownership, recipient, time and limits.
6. **Request step-up when required.** A new recipient, policy exception or
   other defined condition returns control to Alice on a trusted human
   surface. Alice may approve or decline; approval does not override a
   failed sanctions or other mandatory compliance check.

If the session has expired, the mandate is invalid, the artwork is not
permitted or the limits are exceeded, the agent must not submit settlement.
The production system should revoke the session on the policy failure paths
defined by the governing policy and return the case for human review.

## 6. Pre-settlement gate and execution

The following is a **proposed** production control flow; it is not implemented
by the current demo.

1. **Mandate gate:** validate the principal, agent session, open and closed
   mandate relationship, artwork, recipient, expiry, usage and applicable
   amount or velocity limits.
2. **Compliance gate:** the licensed institution or its authorized service
   evaluates sanctions, counterparty eligibility, AML rules and applicable
   Travel Rule requirements. Record the decision and its validity period.
3. **Human step-up:** obtain approval on a non-agent trusted surface when
   required by policy. A decline or missing approval stops the action.
4. **Revalidate at release:** verify that the session, mandate, approvals,
   eligibility and screening decision still apply to the exact transaction.
   Authorization must not be reusable for a different transaction.
5. **Execute settlement:** only after all required gates pass, release the
   authorized transaction through the production settlement mechanism.
   Atomic artwork-and-payment settlement is a design goal only if integrated
   payment rails and an appropriate atomic mechanism are actually provided.
6. **Confirm and reconcile:** wait for the chain receipt, verify the resulting
   owner and any independently confirmed payment outcome, then record the
   mandate reference, decisions and transaction identifiers.
7. **Handle failure:** deny release, revoke the agent session where policy
   requires, and refer the case to the licensed institution for review and
   any applicable reporting. Do not treat a submitted transaction as final
   until its actual chain outcome is known.

Production enforcement must cover all relevant transfer and settlement paths;
a UI check alone cannot prevent an independently signed direct transfer.

## 7. Human flow: monitor, revoke and close

1. Review the registry, mandate usage, transaction references and outcomes.
2. Revoke the mandate or end the agent session if authorization is no longer
   needed or suspicious activity is detected.
3. Separately review and revoke token-specific and operator-wide approvals
   where applicable. Revoking a mandate is not the same as revoking an
   ERC-721 approval.
4. If a transaction was submitted before revocation, check its receipt and
   reconcile its outcome; revocation is not a guarantee that a pending
   transaction was cancelled.
5. Escalate exceptions to the responsible licensed institution. Retain
   evidence according to the applicable privacy and retention policy.

## 8. Current demo: actual operation

The following steps describe the existing qBESU implementation, not the
proposed production design above.

### Human Wallet

1. Open [Human Wallet](./human-wallet.html), unlock the principal's ICCHSM
   wallet and register the collector if necessary. The principal must own the
   artwork; the recipient must be registered and listed.
2. On the principal's wallet page, open **Human mandate for agentic work**.
   Enter the recipient address, one or more owned artwork contract addresses,
   expiry and maximum transfers.
3. Select **Authorize Agentic Work**, review and confirm the request, and
   wait for the qBESU receipt. Save the displayed mandate ID; the wallets do
   not enumerate mandates.
4. Enter the mandate ID and artwork address, select **Inspect mandate**, and
   select **Approve artwork**. Approval is separate for each artwork and
   replaces any existing token-specific approval.
5. To stop future mandate execution, select **Revoke mandate**. Separately
   use **Revoke artwork approval** for token-specific approvals as needed.
   Operator-wide approvals require separate management.

### Agent Wallet

1. Open [Agent Wallet](./agent-wallet.html), unlock the **same principal
   wallet**, and select an artist or collector role. Selecting a role does
   not create a mandate or establish a distinct agent identity.
2. On **Wallet Mandate**, enter the mandate ID and artwork address and select
   **Inspect mandate**. Review the principal, recipient, expiry, remaining
   transfers, permission, ownership and approval.
3. Select **Execute mandated transfer**. The principal reviews the displayed
   details and approves or declines the on-screen request.
4. After approval, the wallet rechecks the mandate and submits the transaction
   using the principal's ICCHSM signing service. Wait for confirmation and
   review the registry and transaction reference.
5. WebMCP clients can use `inspect_mandate` and
   `execute_mandated_transfer`; execution also requires on-screen approval.

The demo has **no Tier-3 or Tier-4 certificates, AP2 open/closed mandates,
pre-settlement AML gate, sanctions screening or real payment settlement**.
The human and agent share a key, and direct transfers can bypass the mandate.
Payment in the resale flow is simulated. The PIN is kept in browser-session
memory and sent to the existing HTTPS proxy in a GET query parameter; the
service-side signer and its hardware guarantees are outside this repository.
Use disposable demo wallets, not production credentials.

## 9. Current demo compared with AP2 production

The current Human Wallet creates a **constrained on-chain artwork-transfer
mandate**. It is open-like because it defines a scope for later actions, but
it is **not an AP2 Open Checkout Mandate or Open Payment Mandate**. The Agent
Wallet inspects and executes that same mandate after human confirmation; it
does **not create an AP2 closed mandate**. AP2 concerns checkout and payment
authorization, whereas the demo mandate controls an ERC-721 token transfer.

| Topic | Current demo | AP2-based production method |
|---|---|---|
| Human authorization | The principal signs a qBESU transaction creating a transfer mandate with one recipient, an artwork allowlist, expiry and transfer count. | For autonomous payment, the user authorizes separate open Checkout and Payment Mandates on a trusted surface. They define applicable checkout and payment constraints and bind the authorized agent key. These would be new AP2 artifacts, not the existing contract record. |
| Specific transaction | The agent wallet displays the mandate and a specific artwork and recipient for human confirmation; it then rechecks and executes the original on-chain mandate. | For autonomous payment, the agent assembles and signs closed Checkout and Payment Mandates for the specific checkout under the corresponding open mandates. Verifiers check the authorization chain and relevant constraints. |
| Human-present alternative | The agent wallet asks the human to approve each mandated transfer. | AP2 also supports a direct, human-present flow: the user reviews and approves the closed checkout and payment mandates. An agent-signed closed mandate is not the only AP2 mode. |
| Identity and signing | Human and agent use the same principal wallet; the contract requires the principal as caller. Selecting an agent role does not create an agent identity. | Autonomous AP2 uses an authorized agent key, bound to the open mandates, for agent-signed closed mandates. The proposed separate agent session and certificates are application architecture choices, not a claim that AP2 requires the demo's Tier-3/Tier-4 scheme. |
| Payment and settlement | The resale payment is simulated. The transfer mandate enforces neither price nor payment; direct token transfers can bypass it. | AP2 authorizes checkout and payment through participating merchant and payment roles. A production integration must connect actual payment rails, verify outcomes and separately define how payment relates to artwork transfer. AP2 alone does not make the two atomic. |
| Evidence and verification | qBESU records the transfer mandate and token transaction. ERC-721 approval is separate and persists after mandate revocation until transfer or separate revocation. | AP2 participants verify the relevant signed checkout and payment mandates, applicable constraints and authorization chain, and exchange the applicable receipts. Artwork ownership, token approval and any compliance controls need separate verification. |

### Example: current demo

1. Alice unlocks the human wallet, creates the on-chain transfer mandate for
   Bob and explicitly listed artworks, then separately approves the relevant
   token for the mandate contract.
2. In agent mode, the same principal wallet is unlocked. The agent or user
   inspects the mandate and proposes a particular permitted artwork transfer.
3. Alice confirms the displayed details. The principal wallet signs the
   contract call; qBESU applies the transfer limits and records the outcome.
   No AP2 mandate is issued and no payment is settled by this operation.

### Example: proposed AP2 autonomous payment flow

1. On a trusted surface, the buyer authorizes appropriate open Checkout and
   Payment Mandates, including the agent key and applicable constraints such
   as merchant, line items, amount, budget or validity as supported by the
   selected AP2 profile.
2. The agent obtains the merchant-signed checkout, prepares the specific
   closed Checkout and Payment Mandates, and signs them with its authorized
   agent key. The verifying parties receive the closed mandates and the
   relevant open authorization evidence and disclosures.
3. The merchant and payment participants verify the applicable mandates and
   constraints, carry out their respective checkout and payment processes,
   and return the applicable receipts. This is a proposed integration, not
   a capability of the current demo.
4. The artwork-transfer system independently verifies the seller's authority,
   ownership, token approval and any application-specific settlement
   conditions. Its relationship to confirmed payment must be designed and
   enforced separately.

For the direct AP2 alternative, the user reviews and approves the specific
closed checkout and payment instead of relying on an autonomous agent-signed
closed pair under open mandates.

References: Google's [AP2 specification](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md),
[Checkout Mandate](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/checkout_mandate.md)
and [Payment Mandate](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/payment_mandate.md).

## 10. Related documents

- [Production presentation](./PRODUCTION_PRESENTATION.md) - intended
  production architecture.
- [Demo presentation](./DEMO_PRESENTATION.md) - current demonstration scope.
- [Contract and wallet reference](./contracts/README.md) - implementation,
  mandate behavior and limitations.
- [Deployment addresses](./contracts/ADDRESS.md) - qBESU contract addresses
  and deployment transactions.
