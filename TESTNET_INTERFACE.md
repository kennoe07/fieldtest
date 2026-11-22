# Local testnet interface

Run `npm run dev:testnet`, then open `http://127.0.0.1:5190/#testnet`.

The page verifies the completed trial's funding, payout and refund using the fixed official testnet reader, pinned package policy and historical campaign states. It also checks the current campaign is closed with zero escrow. It reads only the named public review/confirmation files in the workspace outputs folder. Missing or inconsistent files fail closed.

The new funding button prepares and simulates a separate 10-test-USDC lab campaign using the existing preparation script. It returns review details and CLI signing commands. It does not sign, submit or change Supabase records. A unique review file preserves each attempt. The completed trial remains separate from this newly prepared review. Before submitting, verify and simulate the actual signed bytes; CLI signing can change the replay nonce. A predicted creation object ID is not a confirmed campaign ID.

The fixed lab deadlines are 45 minutes for submission plus 15 minutes for review. Preparation expires after 15 minutes. This application expiry does not establish expiry of a signed authorization on chain. Do not prepare a replacement for a signed attempt without reconciling it first.

Only the dedicated loopback server exposes the API, at port 5190. Host and Origin checks reject cross-origin requests, preparation is serialized, responses are not cached, and no arbitrary file, signing or execution endpoint exists. Normal development and production builds expose no lab API; the production route is disabled.

Current interface coverage: confirmed trial history and new funding preparation/CLI signing handoff. Enrollment, feedback commitment, approval, receipt reconciliation for new attempts and refund actions still require the checked guided CLI workflow. Do not present this as complete cloud payment integration. Mainnet and production payment storage stay disabled.
