# AI-assisted findings

Implementation prepared; no feedback has been sent to OpenAI by Codex. The user does not yet have API billing enabled. All model responses in local tests are fixtures. This is not a live model-quality evaluation.

## Activate storage first

Run `supabase/migrations/003_ai_findings.sql` once in the existing Supabase project's SQL Editor. It adds owner-readable reports and private generation leases. Do not rerun the earlier migrations. Deploy this source to Vercel. Existing server-only Supabase environment variables are reused.

Without an OpenAI key, the page shows that generation is not enabled. Deterministic results, exports, reviews, and original responses remain usable. A missing migration shows a setup error rather than fabricated reports.

## Enable generation when ready

Create an OpenAI API project, enable API billing, and create a project API key. Configure account/project usage limits and alerts; check which controls are alerts rather than hard spending caps. Enter `OPENAI_API_KEY` directly into Vercel as a **Secret**, Production only. Never send it in chat or put it in a VITE variable, repository, or frontend file. Redeploy after saving it.

Optional server configuration: `OPENAI_FINDINGS_MODEL`, default `gpt-4.1-mini`. The selected model must support the Responses API and strict structured outputs. Changing this value does not force regeneration of an otherwise current cached report.

Official references:
- https://developers.openai.com/api/docs/quickstart
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-4.1-mini

## Data, trust, and limits

Generation is an explicit owner action with a checkbox explaining what is sent to OpenAI. Input includes campaign goals, tasks, acceptance criteria, and task outcome/expected/actual text. Structured names, emails, wallet addresses, screenshot data/paths, actual submission IDs, product URLs, and overall free-text summaries are omitted. Response references are anonymous labels resolved server-side. Personal information may still appear inside task or campaign free text; this version does not automatically redact it. Review that text and obtain appropriate participant permission before sending it. Builder permission alone does not establish participant consent.

Calls use the Responses API with `store:false`. That setting does not establish zero retention under all provider policies. There are no tools, external browsing, screenshots, or automatic review/payment actions. Untrusted feedback is explicitly treated as data in the prompt.

All saved findings must have exact, nontrivial excerpts from actual-response text with real source references. References and quote integrity are checked; semantic interpretation, suggested fixes, and generalization cannot be guaranteed by these checks. Every finding is marked as AI analysis and retains a source-feedback button. Supporting sample counts are computed on the server, not accepted from the model.

Input limit: 60,000 characters. Output token cap: 3,000. Up to eight findings and eight excerpts per finding, further constrained by the output cap. Requests time out after 45 seconds; function duration is configured at 60 seconds. No automatic provider retries. Oversized input is rejected, not silently sampled.

Maximum five generation attempts per signed-in owner per rolling 24 hours; cooldown/lease checks prevent concurrent owner requests. Failed provider attempts count toward this cap. Unchanged reports are reused. Fingerprints include source text, statuses, versions, task/goal/criteria input and prompt version. New or revised feedback marks cached reports outdated. Reports are rechecked against source changes during generation; a narrow concurrent-change window may still store a report that the next load correctly marks outdated. Only the most recent report is retained.

The five-attempt cap is per account, not a global organization spending cap. Use provider-side account limits and monitoring before inviting many builders. Wallet/tester identities are not proof of unique people.

## Verification

`npm run test:findings`: 30 local cryptographic-free evidence/API-guard/PostgreSQL checks. PGlite fixtures represent Supabase-owned roles/auth tables. Model/provider results are mocked. TypeScript and the production build pass. No deployed endpoint generation, authenticated end-to-end report generation, or model-quality evaluation has been completed.

After enabling billing: generate findings on the existing one-submission pilot. Verify excerpts and the reported sample size, reload to verify persistence, and confirm unchanged reports are reused without a provider call. Revise or add feedback, verify the outdated marker, and generate an updated report. Check unrelated tester access is denied. Keep manual findings and original evidence as the source of truth.
