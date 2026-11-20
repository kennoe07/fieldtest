# Isolated testnet construction and simulation

## What is ready

The unsigned transaction builder now accepts an explicit `sui:testnet` network and pins Circle's testnet USDC type. Its existing mainnet default is preserved. `testnetTermsDocument` creates salted testnet terms separate from the production document configuration. The receipt verifier accepts either reviewed network with the exact corresponding asset, genesis, package and document; cross-network combinations fail. The production worker, database constraints, intent preparation and wallet ownership messages remain mainnet-only.

Coin type source: [Circle's native USDC on Sui announcement](https://www.circle.com/blog/now-available-native-usdc-on-sui). Testnet USDC is `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC`. Mainnet USDC is a different type and cannot be substituted. RPC methods and field shapes were checked against the installed official Mysten SDK 2.39.1 sources.

`simulateTestnetReward` constructs unsigned bytes from a testnet lab intent, never from browser-supplied transaction bytes. It verifies the pinned node identity and reviewed package metadata, current epoch, real coin references, sender ownership, coin types and available balances. It resolves the campaign/clock shared-object references and verifies the campaign terms/asset for existing campaigns. Funding uses selected test USDC objects; separate sender-owned SUI pays gas. Each action is constructed by the existing constrained Move-call builder. Input snapshots may become stale later; a simulation is not a guarantee of future execution.

Gas budget is explicitly set and capped at 100,000,000 MIST in this harness; no fee estimate is presented as a guaranteed charge. Price comes from the node's reference gas price. Coin-gas bytes expire at the current epoch. The simulation adapter uses enabled transaction checks and disables automatic gas selection. It never requests mocked gas. Success requires an exact effects transaction digest, consistency of the envelope digest when present, and reported computation plus storage costs within the chosen budget. Live simulation can omit the optional envelope digest. Gross-cost checking is conservative and can reject a transaction that benefits from storage rebates.

### SUI address-balance gas

Set `gasMode:'addressBalance'` and omit `gasCoinId` when SUI is stored directly at the sender address. The helper checks the node's **addressBalance**, not the combined coin/address total, against the full budget. It sets the gas owner to the sender and payment to `[]`, with no conversion or withdrawal transaction. Selected USDC funding coins remain unchanged.

An empty payment has no coin-version replay protection. `setAddressBalanceGas` binds the genesis digest, current-through-next epoch window and a cryptographically random 32-bit nonce using `ValidDuring`. Current testnet rejects timestamp-based expiration, so timestamp bounds stay null. An app's shorter preparation expiry does not prove these bytes have expired on chain. Persist the selected bytes/digest before any future wallet prompt; never regenerate a bound intent or release it on a wall-clock timeout. Provable expiration settlement remains separate work.

On 20 November 2026 a live unsigned probe against the fixed official testnet RPC succeeded using address-balance gas and a framework clock read. No gas coin was selected, and the queried address balance was 2,000,000,000 MIST both before and after. Nothing was signed, submitted or published. This validates address-balance gas and the simulation response shape, not the unpublished reward contract. The node initially rejected timestamp limits; the successful probe used the supported epoch window.

The optional command `node scripts/probe-testnet-address-gas.mjs PUBLIC_ADDRESS REVIEWED_TESTNET_GENESIS_DIGEST` reproduces that read-only probe. It checks the fixed endpoint's chain identity, reads balances, serializes unsigned bytes and calls simulation only. Do not run it as part of offline tests or treat its simulation digest as a submitted transaction ID.

The result contains the same unsigned bytes, their SDK-computed digest, network and gas budget, and `submitted:false`. There is no signing, execution, publishing or database-binding call. No production API or UI invokes the harness.

## No deployment step required now

Push/deploy this commit as usual. **No SQL or new environment variables are required.** No package ID, deployment digest, genesis digest, funding coin, gas coin, wallet or runtime policy is preconfigured. Placeholder/example IDs must not be used as approved deployment policy. Testnet lab documents/intents never enter the mainnet-only production database.

The factories use fixed official mainnet/testnet endpoints. A real simulation must use `createTestnetRewardReader`; never accept a browser-provided RPC URL or injected reader. Injected clients/readers exist for server tests and are trusted dependencies. Node responses and the separately reviewed package remain trust boundaries; this is not independent checkpoint-signature verification.

## Before a real testnet run

1. Resolve the outstanding wallet warning/ownership verification as applicable; do not bypass Slush's review.
2. Review the Move source and explicitly authorize publication to testnet. No package has been published during this work.
3. Record and review the actual testnet package ID/version/digest/publication transaction and genesis digest. Provision a separate lab policy, never relabel a mainnet plan.
4. Choose a test wallet with testnet SUI and Circle test USDC and supply its current coin IDs to the harness. Test assets have no mainnet funding role. No faucet request or wallet operation was performed here.
5. Run read-only simulation of each action against the deployed testnet contract, including failures and balance checks. Publishing and creating the funded test campaign are separate explicitly authorized transactions.
6. Validate enrollment/submission event confirmation and end-to-end execution before wiring authenticated UI/intent binding. Production database support for a testnet funded flow is still separate work; do not loosen its network constraints to reuse production plans.

## Validation

`npm run test:reward-testnet` uses actual SDK unsigned serialization and synthetic RPC/BCS fixtures. It checks all five calls, sender/gas/epoch/asset construction, network/package mismatches, wrong owners/assets, inadequate balances, duplicate selections, gas bounds, simulation failure/timeout/digest mismatch, receipt verification for funding/payout/refund, and enabled-check transport flags. These tests contact no live RPC, use no signatures and move no funds. They do not prove live gRPC compatibility or deployed-contract behavior.
