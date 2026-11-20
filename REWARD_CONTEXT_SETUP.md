# Authoritative reward mappings

## Database preparation

Apply **006_reward_context.sql** once after migrations 004 and 005. Do not rerun older migrations. Then deploy this commit. No new environment variables are needed. This adds server-only records and functions; it does not activate a wallet prompt, funded invitation endpoint, scheduled worker, or payment.

## Saved records

`ft_reward_participants` fixes a tester account, its verified wallet address, the accepted terms hash and acceptance time for a funded plan. A service-only acceptance RPC checks funded state, exact terms, submission deadline, capacity and verified wallet ownership. It rejects the builder as a tester, admits the participant into the existing research session, and makes identical acceptance retries idempotent. A future endpoint must authenticate the tester and collect explicit consent; this RPC alone does not establish a user session or prove consent. No such endpoint is active.

`ft_reward_commitments` stores immutable versions of a submitted feedback document and its source snapshot. The preparation helper reads feedback from the database, downloads referenced images from the fixed private evidence bucket, validates tester/campaign path ownership and file limits, and hashes their bytes. It never accepts browser-supplied documents, image URLs or hashes as authoritative. The service-only save RPC locks the plan/submission, compares the snapshot against current feedback, validates document fields, and independently computes SHA-256 over the supplied canonical text. The helper checks that the returned database hash matches its own. SQL checks evidence metadata; the trusted server is responsible for reading and hashing actual image bytes.

A review status/note change does not alter a content commitment. A revision can create another commitment while earlier versions remain available for reconciliation. Each preparation call creates a new random salt; identical SQL retries are idempotent, but calling preparation again can produce another commitment for unchanged content. A future transaction-intent layer must persist/reuse the selected commitment across wallet retries rather than regenerate it. These records do not prove that enrollment or submission transactions occurred on-chain.

Update: migration 007 and `prepareRewardIntent` now reuse a saved commitment for the current feedback snapshot while atomically saving the selected transaction intent. The standalone legacy preparation helper still creates a candidate salt per call. Use the intent path for future wallet integration; see `REWARD_INTENTS_SETUP.md` for its inactive binding/execution boundaries.

Both new tables deny browser access. The service role can select them but must use the checked RPCs for writes. Database administrators remain trusted. Current unfunded campaigns and their invitation/submission flows are unchanged.

## Receipt processing

The context resolver derives the campaign terms hash from the exact historical output object, then loads a unique saved plan under the pinned network/package. For payouts it requires accepted terms and the saved feedback commitment matching the paid seat's hash and tester address. It verifies stored document hashes and identities before handing context to the receipt verifier. Historical commitments are used rather than mutable current feedback.

`processMappedRewardCheckpoint` composes this resolver with the existing checkpoint worker and privileged database store. The receipt verifier still checks transaction success, provenance, asset, historical state and balance transitions. No resolver call by itself proves a payment. Unknown or inconsistent mappings stop checkpoint processing for reconciliation.

## Remaining activation work

No live policy, cursor, job or public endpoint is configured. Funded consent/session endpoints, on-chain enrollment/submission confirmation, reusable transaction intents, explicit testnet policy/asset support, and real end-to-end testnet validation remain necessary. Slush review and wallet verification are still pending. No contract was published and no funds moved during this work.

## Validation

Run `npm run test:reward-context` for server mapping/evidence fixtures and PostgreSQL migration tests through PGlite. Coverage includes browser denial, verified-wallet/terms checks, snapshot races, independent hashing, revision retention and invalid evidence. These tests do not contact a live chain or demonstrate a funded user flow.
