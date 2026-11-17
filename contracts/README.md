# Fieldtest reward escrow prototype

Not published or integrated with the app. No funds have been deposited. Local Move VM tests: **27 passed, 0 failed**. Production Move build passed. These checks are not a security audit.

## Rules

- One shared Campaign per funded campaign. Generic coin type, fixed integer reward in coin base units, maximum 50 seats. The product decision is native USDC on Sui mainnet, with six decimal places. Transaction builders now support explicit USDC coin inputs separately from SUI gas. Current app reward numbers are planning values and are not automatically funded.
- Creator deposits exactly `reward * slots`. Reward, capacity, campaign terms hash, submission deadline, and review deadline are immutable. Review deadline must be later than submission deadline. There is no early refund or cancellation.
- Creator enrolls tester addresses before the submission deadline. Self enrollment, zero address, duplicate addresses, and exceeding capacity are rejected. This is a deliberate admission step, not an open join: backend invitation acceptance does not yet perform on-chain enrollment.
- Enrolled tester signs a 32-byte submission commitment before the deadline. Unpaid revisions may replace it before that deadline. No raw research or email addresses are stored on chain. Salted canonical campaign/submission document helpers are implemented and tested, including evidence-byte hashing. Authoritative storage and on-chain binding are still pending; hashes and wallet activity are public.
- Creator approves an exact submission digest before the review deadline. The transaction atomically marks the seat paid and transfers one reward to that seat's fixed address. Repeated payments and stale digests abort. There is no separate claim step.
- At or after the review deadline, only the creator can close the campaign and recover all unpaid funds. Paid rewards remain with testers. Approval and refund periods do not overlap.

## Trust and integration boundaries

This enforces budget custody and payment mechanics, not the quality or fairness of reviews. A creator can refuse to approve and recover unpaid funds after the review window. There is no arbitration, automatic acceptance, or proof of human uniqueness. Each address gets at most one seat; one person may control multiple addresses. Never market this prototype as a guaranteed payout for submitting feedback.

Before funding, bind the builder and tester wallets to authenticated accounts using verified, expiring, domain-bound signature challenges. Freeze a canonical campaign document; include a unique application campaign identifier and nonce in its hash; index confirmed chain events. Approval in the current Supabase UI does not execute this contract. Build retry/reconciliation behavior so a database error cannot duplicate a payment or mislabel a reward as paid.

Revision cutoffs must be aligned with the app, which currently permits revisions based on its separate database workflow. The on-chain submission window is strict; revisions after it are rejected. Choose and display a reasonable review period before accepting testers.

Package upgrade policy and production review remain unresolved. Run local tests and testnet integration, then review package immutability/upgrade authority before any capped mainnet pilot. No publishing, wallet signatures, or spending is authorized by this source preparation.

## Run

Using the official Sui CLI:

```sh
cd contracts/fieldtest
sui move test
sui move build
```

The test suite uses the real Move VM and shared-object scenarios, including recipient balance assertions. It is not a JavaScript simulation. Toolchain used during development: official `testnet-v1.84.0` release. This does not select a deployment network or publish anything.

The framework is pinned to commit `9dc25070cf2ed18bcda1ebb095f39708638195a8`. For the verified local run, a temporary package copy replaced that Git dependency with a local checkout of the exact same commit, avoiding a stalled redundant dependency download. Source and test SHA256 hashes were checked identical to the tracked files. The tracked Git-dependency fetch path itself has not completed here.

Sources: https://sdk.mystenlabs.com/dapp-kit and https://www.docs.sui.io/develop/testing-debugging/testing
