# Reward-plan storage and ledger foundation

## Activation

Apply `supabase/migrations/004_reward_records.sql` once in the existing project's SQL Editor. It requires migrations 001 and 002; do not rerun them. The migration is transactional and changes the public invitation function to delegate to its original implementation in the private schema for ordinary unfunded campaigns. Frozen reward campaigns are explicitly blocked from that old flow pending a dedicated funded-participation implementation.

Deploy this commit to Vercel. No new environment variables are required: `/api/reward-records` uses the existing server URL and publishable key with the signed-in user's token. It does not use privileged credentials or expose a freeze/event-writing action.

On a future campaign, choose a proposed review window and select Save reward-plan draft. Refresh and check the saved value/timestamp returns. This persists across signed-in devices. It does not freeze terms, reserve rewards, trigger a signature, or deposit funds. Expired campaigns cannot save a funding draft.

## Storage boundaries

- `ft_reward_drafts`: owner-readable proposed review windows, saved through an owner-checked RPC.
- `ft_reward_plans`: owner-readable immutable terms documents/digests and plan state. Frozen means **not funded**. Terms include a private salt; testers cannot read the plan table. Final public/tester-facing acceptance views remain to be implemented.
- `ft_reward_events`: append-only records for funding, payouts, and refunds. Owner-readable, with transaction digest/event-sequence replay keys and one-payout-per-tester constraints. No HTTP ingestion endpoint exists.
- Only service-role RPCs can freeze a plan or record ledger events. Browser users cannot call them or write these tables. Freezing requires a verified owner wallet, future deadline, saved draft, no existing testers, and a document matching the database's authoritative campaign fields, amounts and cutoffs. Identical retries return the existing plan; conflicting changes fail.
- Draft saves, freezes, and joins lock the same campaign row. New frozen plans cannot keep admitting testers through the unfunded flow. Existing unfunded campaigns are unaffected.
- Funding must match the entire budget. Paid events must match the fixed reward and chain object; duplicate payouts and inconsistent refunds are rejected transactionally. A failed insert rolls back any balance change. Recorded payouts plus refunds cannot exceed the recorded budget through these functions.

## What is deliberately not active

There is no public freeze operation, contract deployment, wallet signature request, funding endpoint, or chain-event worker. The database does not cryptographically verify terms hashes or authenticate blockchain events itself. A future trusted server verifier must build/hash terms with the canonical helpers, verify the exact deployed package/network/asset, and prove successful transaction effects and event provenance before calling privileged RPCs. Until that exists, no live plan should be frozen and no chain event should be recorded. Service-role credentials are part of the trust boundary and must remain private.

Chain events can arrive out of order; the future worker must process/retry them in chain order and reconcile missed events. This ledger rejects invalid ordering rather than guessing. Enrollment and submission commitments also need their own verified mappings. A database approval must not be treated as proof of payment. Participant wallet ownership, acceptance of frozen terms, and mainnet review remain required before enabling funded joins.

## Validation

- 36 reward storage/ledger/API-guard checks passed in PGlite using actual migrations 001, 002 and 004 with fixtures for Supabase-owned roles/tables. Synthetic events and trusted wallet links are fixtures, not real chain verification.
- All 37 existing PostgreSQL research/workflow checks passed with migration 004 applied, including the original invitation, evidence, revision, resubmission, and approval paths.
- TypeScript and the production build passed. Server route syntax checked.
- Live migration application, authenticated HTTP draft save/restore, and visual verification remain pending after deployment.

Slush review and wallet linking remain pending. AI billing/key and the deferred email sender/domain setup are separate launch items.
