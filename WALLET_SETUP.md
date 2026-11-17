# Verified wallet linking

Implementation prepared and locally tested; not activated against the live database or deployed API yet. The app asks users to review an expiring message before requesting a personal-message signature. It does not sign a transaction or transfer funds.

## Activation

1. Run `supabase/migrations/002_wallet_links.sql` once in the existing project's SQL Editor. Do not rerun migration 001. This adds a private challenge table and owner-readable verified wallet table, plus scoped RPC functions.
2. In Vercel project Settings > Environment Variables, add the following **server-only** names for Production:
   - `SUPABASE_URL`: the existing project URL.
   - `SUPABASE_PUBLISHABLE_KEY`: the existing browser-safe publishable key.
   - `SUPABASE_SERVICE_ROLE_KEY`: a server secret/service-role key from the project's API settings. Enter it directly in Vercel. Never paste it into chat, frontend code, or a VITE variable. This key is privileged and is used only by the verifier endpoint.
3. Deploy/redeploy the source containing `api/wallet.mjs`. Do not merely upload the static dist folder: this feature needs the Vercel Node function.
4. Sign in on https://fieldtest-two.vercel.app, connect a standard Sui wallet, prepare the verification message, review it, and sign it yourself. Check the verified address after refresh. A different connected wallet must not silently replace it.

Production origin and local development origin are deliberately allowlisted in the API and SQL. Changing the domain requires updating both. Local `vite preview` does not host `/api/wallet`; use configured Vercel deployment for the live test. Browser QA and real wallet signatures have not been performed for this slice.

## Rules and limits

- Five-minute challenge bound to account UUID, origin, normalized address, mainnet network label, random nonce, and explicit linking purpose.
- One current challenge per account; 30-second issuance throttle. New challenge supersedes old one. Completion consumes the nonce atomically, rechecks expiry, and rejects races/replays.
- Server verifies a genuine Supabase user session and the signature; browser cannot write wallet links or invoke the completion RPC.
- One permanent wallet per account and one account per wallet in this version. No unlink/rotation UI yet. Resolve recovery and active escrow implications before offering wallet changes.
- Ed25519, secp256k1, secp256r1 only; zkLogin, multisig, and passkey signatures are rejected explicitly pending separate verifier support.
- No signature is saved in database or logs. A wallet signature proves control, not unique human identity. Displayed account UUID and address are part of the signed message.
- Current Vercel API is a small verification service alongside the frontend; planned Render jobs remain separate.

## Local verification

`npm run test:wallet`: 31 real cryptographic/API-guard/PostgreSQL checks. The SQL tests use PGlite and fixtures for Supabase-owned roles/auth tables, not the live project. No email or deployed HTTP flow is tested by these checks.

`npm run test:rewards`: 18 unsigned transaction-preparation checks. Builders cover create/enroll/submit/approve/refund and exact SUI-to-MIST conversion. They are not wired to execution and do not simulate the chain. Contract tests are separate: 26 Move checks from the previous slice.

Before funded integration: canonical salted document hashing, confirmed-event indexing/reconciliation, wallet ownership enforcement at transaction preparation, deadline alignment, package/network verification, testnet integration, and package upgrade policy review.
