# USDC reward integration checkpoint

User decision: keep USDC rewards. No contracts were published, wallets prompted, funds moved, or chain RPCs called in this slice.

## Implemented

- Native Sui mainnet USDC is pinned as `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`, with six decimals. Metadata checked against Circle's Sui page and Sui's contract reference. Reverify the deployed network/type/coin metadata before enabling real funding.
- `lib/reward-transactions.mjs` supports explicit `asset: 'USDC'` for every escrow action. Creation takes 1–50 unique funding coin object IDs, merges if necessary, and splits the exact budget from those objects, never from the SUI gas coin. Old SUI fixture behavior remains for backwards compatibility; production reward callers must explicitly select USDC.
- `src/rewardDocuments.ts` provides canonical sorted-object UTF-8 JSON and SHA256 digests, preserving array order and exact strings. Only safe integer JSON numbers are accepted; amounts/timestamps use integer strings. Fresh salts use 32 cryptographically random bytes.
- Terms bind network, package, application campaign, owner address, native asset/decimals, reward/capacity, deadlines, and exact research instructions. Missing package/wallet inputs and expired submission deadlines are rejected. The helpers do not themselves establish wallet ownership or verify a package on chain: authoritative server integration must supply those verified inputs.
- Submission commitments bind the terms digest, matching campaign/tasks, submission ID, tester address, exact responses/summary, and hashes of actual image bytes. Temporary signed URLs and private storage paths are excluded. Remote evidence requires an authorized byte-loader callback; that callback is not wired to a production commitment endpoint yet. Review-only status/note/timestamp changes do not alter content commitments. Changed response text or screenshot bytes do.
- A read-only campaign funding preview displays USDC reward, full budget, separate SUI gas requirement, proposed review cutoff, wallet-verification status, and refund/approval rules. Its review-window selector is temporary browser state and does not freeze or save funding terms. No final funding hash or transaction is created by the preview. Actual account wallet linking remains subject to the unresolved Slush review.

## Validation

30 unsigned transaction-builder checks, 20 canonical document checks, 27 actual Move VM checks, and the production frontend build pass. The additional Move test uses a synthetic non-SUI coin; it does not test Circle's live regulated coin, freezes, denylist behavior, or network execution. The Move tests use the pinned local framework checkout as documented in contracts/README.md. No live browser check of this preview has been performed.

## Before real funding

1. Resolve the wallet warning; complete live wallet ownership verification.
2. Deploy and verify the exact contract package first on testnet, then review the mainnet package/upgrade policy. Never use the mainnet USDC type on testnet; configure a separate test asset/network explicitly.
3. Persist immutable, server-authorized terms and salts before funding. Tie plans to campaign owner and a verified wallet. Store submission documents/salts privately and verify matching membership and content version. Never rely on user-supplied hashes alone.
4. Align funded campaign acceptance/revision/review rules with the frozen on-chain deadlines. Existing unfunded research campaigns must not silently become funded under new terms.
5. Fetch owned USDC coin objects, validate types/amounts, select sufficient balance, and estimate/simulate transactions. SUI gas balance is separate. The current builders accept IDs but do not verify ownership or balances themselves.
6. Index confirmed funding/enrollment/commitment/payout/refund events with idempotency and reconciliation. A database approval alone must never show a payment as sent.
7. Test failed signatures, transaction failure, reloads, ambiguous confirmations, concurrent reviews, USDC transfer restrictions, and refund recovery before a capped mainnet pilot.

References:
- https://www.circle.com/multi-chain-usdc/sui
- https://www.docs.sui.io/onchain-finance/deepbook/deepbook-margin/contract-information
