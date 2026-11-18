# Server reward receipt verifier

The server verifier checks a successful checkpointed transaction against a trusted deployment policy and authoritative frozen plan before calling the privileged ledger RPC. No HTTP route or scheduled worker invokes it. Deploying these files activates no payment functionality. No SQL or new environment variables are required.

Checks include mainnet genesis identity; exact package ID/version/digest/publication transaction; canonical terms digest; native USDC type; event provenance; historical campaign input/output versions and digests tied to effects; full funding; escrow balance changes; fixed payout to an enrolled tester's committed submission; and refund cutoff/closure. Initial scope is one direct financial event per transaction. Wrappers, batching and upgraded deployments require separate support and review.

The fixed-endpoint gRPC adapter supplies trusted node responses. This is not a light client or independent verification of checkpoint signatures. The reviewed contract deployment and RPC are trust boundaries. Transfer behavior relies on the approved contract; this is not a general coin-transfer verifier. Missing historical objects cause rejection rather than substitution with current state.

Before activation, a worker must load policy and immutable plans from server storage, establish verified enrollment/submission mappings, process events in checkpoint/transaction/event order, reconcile missing events, and persist proof metadata. Returned receipts contain checkpoint and object version; the current ledger RPC stores only its existing normalized event fields. The worker must look up existing receipts before retrying: the ledger RPC is idempotent, but verification requires the pre-event plan state and balance, so advanced plans cannot simply be replayed through verification.

Update: the inactive checkpoint-worker foundation now stages receipts in order and atomically commits their proof metadata with its cursor through migration 005. See `REWARD_WORKER_SETUP.md`. Retrying starts by reloading that cursor, avoiding re-verification of already committed checkpoints. Authoritative context mappings and an activated runner are still pending.

No real deployment policy is configured. No package has been published, signature requested, or funds moved. Slush review and wallet verification remain pending. Testnet end-to-end validation must precede mainnet activation.

`npm run test:reward-verifier` runs 29 fixture checks covering valid funding/payout/refund, chain/package/provenance failures, effects and checkpoint failures, historical object substitution, malformed BCS, changed terms/budgets, commitment/order failures, refund timing, database errors, and rejection before database writes. These tests make no network calls and do not prove live gRPC compatibility or real-chain correctness.
