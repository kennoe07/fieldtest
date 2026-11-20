# Isolated testnet escrow trial

The reward package is checkpoint-confirmed on testnet. Its verified deployment record is in `outputs/fieldtest-verified-testnet-deployment.json`. This is not a production deployment policy and does not enable the mainnet-only database or worker.

`node scripts/prepare-testnet-campaign.mjs` reads that policy, selects sufficient sender-owned native test USDC coin objects, creates canonical salted lab terms, and simulates unsigned creation through the existing checked testnet helper. It saves a fresh review artifact without overwriting another review. It never signs, executes, freezes a production plan or calls Supabase.

The lab deposit is 10 test USDC: two seats at 5 test USDC each. Use one independent tester signer to test a payment and leave the other seat unused to test refund conservation. The owner cannot enroll itself. The builder and tester must be separate user-controlled accounts; private recovery output must stay in the user's terminal. Both need test SUI gas, but only the builder needs the USDC deposit.

The unsigned lab draft uses a 45-minute submission window and a further 15 minutes for review. These are explicit isolated lab overrides, not changes to the production day-based rules. The 15-minute preparation expiry does not prove a signed transaction's chain expiry. Deadlines become fixed if funded, and unused escrow can only be refunded after the review cutoff. Refresh an unsubmitted review if setup would consume its useful window, then show the new terms before signing. Never fund first and assume those deadlines can be edited later.

The first live unsigned create simulation on 20 November 2026 succeeded with the verified package, real owned test USDC and SUI address-balance gas. It reported computation 1,000,000 MIST, storage 3,777,200 MIST and rebate 1,322,268 MIST, within the 10,000,000-MIST budget. No deposit was submitted. Simulated campaign IDs are predictions only, particularly because the CLI can refresh the replay nonce while signing.

Before each submitted step, verify the actual signed bytes and account, permit no unreviewed semantic changes, resimulate and present its spend/recipient/cutoff for review. Confirm the resulting effects/event/historical campaign state against the frozen lab document. Save exact commitments and receipts locally. Do not treat database review status as proof of payment. Enrollment and submission verification and trial driving still need implementation/validation before production integration.

Trial sequence: prepare/fund; accept/enroll the independent tester; commit synthetic feedback as that tester; approve the exact hash as builder and verify 5-USDC receipt; after cutoff refund the unused 5 USDC and verify closed state/zero escrow; check duplicate payout/refund and wrong-signer failures with read-only simulation. Use no personal feedback or production evidence in this lab.
