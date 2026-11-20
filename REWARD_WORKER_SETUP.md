# Reward checkpoint worker foundation

## What this adds

The server-only `processRewardCheckpoint` processes one complete checkpoint per call in transaction order. It checks the saved deployment-policy fingerprint, mainnet identity, sequential checkpoint number, previous digest, and agreement between checkpoint contents and transaction order. Relevant transactions pass through the existing receipt verifier. Multiple transactions affecting one plan use staged plan balances before committing.

Migration **005_reward_worker.sql** adds a private durable cursor, receipt proof metadata, and a service-only atomic commit RPC. It records all verified financial events and their proofs, then advances the cursor in the same database transaction. Failure rolls everything back. Concurrent workers race through a locked compare-and-swap cursor: only one can commit. After a timeout or crash, reload the cursor before retrying. Empty checkpoints advance normally. Unknown reward events, missing historical objects, invalid receipts, unsupported batches, or unavailable data halt progress; they are never silently skipped.

## Database preparation

Apply migration 005 once, after 004, in the existing Supabase SQL Editor. Do not rerun older migrations. This creates no cursor, scheduler, public endpoint, signatures, or payments. It requires no new environment variables and does not change current unfunded research sessions.

The cursor and proof tables are private to server administration. The Supabase service role needs its standard BYPASSRLS privilege; local PostgreSQL tests execute the commit as a security-definer function. Browser roles cannot read or write worker state or call the commit RPC.

## Activation remains pending

There is deliberately no executable job or scheduler yet. A separately reviewed runner must supply an authoritative `contextForTransaction` resolver for frozen plans and verified submission commitments; no browser payload may supply these mappings. It must provision exactly one cursor for a deployment policy, starting at the package publication checkpoint with that checkpoint's predecessor digest, and persist the exact policy hash. Provision before activating any reward plans. Arbitrary later starts would miss history. Do not auto-create cursors at the chain tip.

Update: migration 006 and `server/reward-context.mjs` now provide the server resolver and saved acceptance/submission records. `processMappedRewardCheckpoint` composes them with this worker. See `REWARD_CONTEXT_SETUP.md` for the remaining endpoint, transaction-intent and testnet work; scheduling and live activation remain disabled.

The runner must have bounded scheduling/time limits and monitoring. Invoke again after a successful checkpoint to continue catch-up; retry the same cursor after transient failures. Reconcile unknown events or preexisting ledger entries explicitly. The atomic RPC rejects receipts already written through another ingestion path, so legacy writes cannot silently acquire unverified proof metadata. Never manually advance a blocked cursor to bypass a failed receipt.

The reader trusts the fixed official RPC and approved contract deployment; it does not independently authenticate validator signatures. Checkpoint continuity and contents comparisons check node response consistency, not a cryptographic light-client proof. Live gRPC compatibility, archive availability, testnet policies/assets, enrollment/submission mappings, and end-to-end testnet execution remain unvalidated. The current policy/verifier is mainnet-specific; testnet support must be added explicitly before testing. Slush review and ownership verification remain pending. No package has been published or funded.

## Validation

`npm run test:reward-worker` runs fixture worker checks plus real PostgreSQL migration/ledger tests through PGlite. They cover ordered staging, missing/changed data, policy pinning, atomic rollback, cursor races, browser denial, proof persistence, empty checkpoints and recovery after a lost commit response. `npm run test:reward-verifier` independently checks receipt validation. No tests call a live chain or request signatures.
