# Fieldtest cloud setup

Status (17 November 2026): connected locally to https://weekjvovcfsmwxgjigwd.supabase.co. The schema has been applied once, all four application tables have RLS enabled, the evidence bucket is private, and anonymous table reads are denied. Email delivery and authenticated end-to-end workflows still need live testing.

## 1. Create a project

Create a dedicated Fieldtest project in https://supabase.com/dashboard and choose a region near your expected users. Keep the database password private. In the project’s Connect/API settings, obtain:

- Project URL, such as `https://YOUR_PROJECT.supabase.co`.
- Publishable key (`sb_publishable_…`), or the legacy anon key.

These two browser-safe values are sufficient for this integration. Never put a secret/service-role key or database password in a `VITE_` variable or send one in chat.

## 2. Apply the schema

In the new project’s SQL Editor, run `supabase/migrations/001_research.sql` once. It creates the campaign, invitation, membership, and submission tables, the workflow RPC functions, row-level policies, and the private `fieldtest-evidence` bucket.

The migration is intended for a new project. Do not disable RLS or make the evidence bucket public. It grants authenticated clients SELECT access subject to RLS; writes to application tables go through scoped RPC functions. No service-role key is needed in the app.

## 3. Configure email sign-in

Email authentication is enabled. Fieldtest supports the default emailed sign-in link with PKCE. Open the link in the same browser where you requested it. The optional code-entry screen also supports a code template after configuring custom SMTP; include `{{ .Token }}` in that template.

The current local Site URL is `http://127.0.0.1:5173`, with redirect allowlist `http://127.0.0.1:5173/**`. Add the deployed frontend URL before testing a hosted build. Keep email confirmation enabled. Do not reapply the initial migration to the connected project.
Use a custom SMTP provider for external testers. Supabase’s default sender is restricted to project-team addresses and low email limits, and new free-tier projects using it may not allow template edits. Configure the sender and domain in Supabase rather than putting SMTP credentials in the frontend.

References: [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [email-template policy](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

## 4. Connect the frontend

Copy `.env.example` to `.env.local` in the `fieldtest` directory and supply the two public values:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Build and restart the preview. For Vercel, add the same two environment variables and redeploy; Vite embeds them at build time. Build command: `npm run build`. Output directory: `dist`.

With no configuration, Fieldtest stays in local mode and Account shows a connection-pending screen. With configuration, primary landing-page actions lead to the cloud account. The local prototype remains available at `#app`. Existing local drafts are never uploaded automatically.

## 5. Verify with two accounts and an unrelated third account

1. Sign in as the builder using the emailed sign-in link in the same browser; create a cloud campaign with a valid product URL and future deadline.
2. Copy the tester invitation. Open it on another device/browser and sign in as a separate tester. Builders cannot allocate themselves tester seats.
3. Accept the invitation, complete every task, attach a screenshot, and submit. Confirm the receipt survives signing in from another device with the same tester account.
4. As the builder, open the campaign and inspect the feedback and screenshot. Request a revision with an explanation; resubmit as the tester; approve as the builder.
5. Confirm an unrelated account cannot query the campaign, submission, or private image. A signed-in user with the invitation link is allowed to join until seats fill or the deadline passes; the link is a bearer invitation.
6. Confirm that repeat joins do not consume another seat and duplicate submissions are rejected.

Signed image URLs last 60 seconds. Unsubmitted evidence is readable by its uploader; the campaign owner receives access only after a submission references it. Uploads are limited by the bucket to 2 MB and JPG/PNG/WebP; submission validation enforces 3 per task and 6 MB total.

## Verification already completed

`npm run test:cloud` runs the actual migration in local PostgreSQL through PGlite. Supabase-owned auth/storage tables are test fixtures. All 33 access/workflow checks passed, including outsider isolation, owner-only reviews, evidence visibility, immutable campaign instructions, seat limits, duplicate rejection, and revision resubmission.

TypeScript and the production build passed, including a build configured with the live project URL and publishable key. Live dashboard checks confirmed RLS on all four application tables and a private evidence bucket. Anonymous HTTP reads were denied on all four tables. Sign-in rendering and empty-email validation were browser-checked without sending email. No real email delivery, Storage HTTP upload, or cross-device cloud session has been verified yet; those require steps 1–5 against the actual project.

## Scope

This is prepared for a limited research pilot, not a claim of audited production readiness. Account deletion/data-retention controls, orphan-file maintenance, invitation rotation, production monitoring, and service-level load/concurrency testing remain follow-up work. The current cloud path uses Supabase Auth, PostgreSQL RPC/RLS, and Storage directly; a Render worker/API remains planned for AI jobs and Sui integration.

There are no funded rewards, wallet signatures, mainnet contracts, automatic payments, or AI-generated findings in this stage. Approval records a research review only.

