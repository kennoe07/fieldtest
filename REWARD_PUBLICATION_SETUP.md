# Unsigned testnet publication review

`server/reward-publication.mjs` and `scripts/prepare-testnet-publication.mjs` prepare and simulate publication only. They import no signer and call no execution, faucet or wallet-connection API. No production route invokes them. No SQL or new environment variables are required.

The preparer checks the current source/test hashes against the independently reviewed offline build manifest, validates the one compiled module's exact bytes/hash, and permits only Sui/MoveStdlib dependencies. It pins the official testnet node to the separately reviewed genesis digest and requires sender-owned SUI address balance covering the whole chosen gas budget. A self-edited manifest is not an independent source/bytecode audit; trust the reviewed build process and pinned compiler/framework.

It constructs exactly a package publication and a transfer of the resulting UpgradeCap to the sender. The package stays upgradeable under that capability. It does not fund a campaign, transfer USDC, burn the capability or make the package immutable. Gas uses an empty payment vector and chain/epoch/nonce expiration. The default and maximum budget in this preparation tool is 100,000,000 MIST (0.1 test SUI).

Simulation runs with enabled transaction checks. The effects transaction digest must match the exact serialized bytes, gas costs must fit the budget, and exactly one package creation must appear. The review artifact saves the unsigned bytes and digest, gas bounds/costs, expiry, UpgradeCap recipient, source/module hashes and simulated package ID/digest. Simulated IDs are predictions, not evidence of an existing package. The tool refuses to overwrite an existing artifact. Regenerating changes the nonce/digest and requires a new review.

Usage after offline build review:

```text
node scripts/prepare-testnet-publication.mjs REVIEW_DIRECTORY PUBLIC_SENDER REVIEWED_TESTNET_GENESIS OUTPUT_FILE
```

The review directory contains `compiled-package.json` and `review-manifest.json` from the offline deployment artifact. Source/test bytes are read from the current tracked contract paths. No private key or recovery phrase is an input.

On 20 November 2026, a live unsigned publication simulation succeeded on Sui Testnet. Computation cost was 1,000,000 MIST and storage cost 23,233,200 MIST, totaling 0.0242332 test SUI with zero simulated storage rebate. This was within the 0.1 test SUI budget. No transaction was signed or submitted. Actual execution cost/state can change; simulation is not a price guarantee or publication receipt.

## Before signing or submitting

Review the exact artifact's network, sender, module/source hashes, retained upgrade authority, budget, transaction digest and byte contents. Check the current chain identity/epoch and sender balance again. Preserve those bytes during wallet signing; never silently regenerate them or switch network/gas owner. If expired, or if any field changes, prepare a new artifact and repeat review. Do not treat the app's wall-clock preparation timeout as proof of chain expiry.

Wallet signing/transport and transaction submission are not implemented by these scripts. They require a separate, explicit user-controlled signing step; no private keys should enter chat or source control. The existing Fieldtest site warning is unresolved; this contract simulation neither clears that warning nor authorizes bypassing it. Production mainnet rewards remain disabled.

After any separately authorized publication, fetch the confirmed checkpointed transaction and package from the pinned testnet node. Verify the digest matches the reviewed bytes, status succeeded, created package bytes/metadata match, and UpgradeCap belongs to the intended address. Only then configure a testnet deployment policy. Never activate the production mainnet-only database using simulated package IDs.

Run `npm run test:reward-publication` for fixture checks of source/module/dependency tampering, network identity, gas balance/budget, exact unsigned commands, failure responses and package-creation validation. These are not signing or execution tests.
