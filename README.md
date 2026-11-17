# Fieldtest — local research workflow prototype

React + TypeScript + Vite. Visual direction informed by the Spector reference: near-black surfaces, cream typography, red accents, an original CSS lens graphic, and editorial section layouts.

## Run

Use Node.js 22.12+ (or a compatible newer release).

```sh
npm ci
npm run dev
```

For a production preview:

```sh
npm run build
npm run preview -- --port 5173
```

Deploy the frontend to Vercel with build command `npm run build` and output directory `dist`. Navigation uses hash routes, so no server rewrite is needed.

## Implemented

- Lightweight one-time scroll reveals and brief navigation transitions; reduced-motion support and a static ticker on small screens. No animation dependency.

- Responsive landing page, interactive process selector, sample findings/submissions tabs, and FAQ.
- Builder workspace, campaign search and status filtering.
- Required-field validation, calculated planned budgets, and local draft persistence.
- Campaign details, separate illustrative examples, and Markdown exports including local submissions and review notes.
- Same-browser invitation links; optional product URL, deadline, and acceptance criteria in campaign creation.
- Task-by-task tester responses, outcomes, review-before-submit, and receipt/status views.
- JPG/PNG/WebP evidence up to 3 images per task, 2 MB each and 6 MB total, persisted as Blobs in IndexedDB.
- Persistent local review decisions, mandatory explanations for revisions/rejections, and revision resubmission.
- One local tester session per campaign; transactional duplicate prevention. This is not identity verification.
- Native modal dialog with keyboard dismissal and reduced-motion styles.

## Connected cloud integration

- Official Supabase client with email-link sign-in (PKCE), optional email-code verification and sign-out.
- Separate account workspace, cloud campaign creation, bearer invitations, task submissions, private screenshot access, and owner-only reviews.
- Application RPC functions and row-level policies in `supabase/migrations/001_research.sql`.
- Account code is loaded on demand. No automatic migration or upload of local preview records.
- The local build is connected to the live Supabase project. Schema, RLS, private bucket, and local auth redirects are configured. See `CLOUD_SETUP.md` for remaining live verification. `.env.local` is ignored and excluded from the source archive.

## Boundaries

The live database is configured; email delivery, authenticated storage uploads, and cross-device workflows still need end-to-end verification. On-demand Sui mainnet wallet connection is implemented. A separate Move reward escrow prototype has 26 passing local tests; see `contracts/README.md`. Live funding, payout integration, and AI services are not implemented. Campaign drafts use localStorage; submitted feedback and screenshots use IndexedDB. These are not protected multi-user accounts. Clearing browser data removes local records. Unsubmitted tester drafts and screenshots autosave in IndexedDB, scoped to account and campaign on the same browser. They do not sync across devices and are not encrypted from other software/users with access to that browser profile. Clearing browser data removes them. Proposed rewards are unfunded; local approval never sends a payment. Invited tester links only work where the campaign exists in browser storage. Sample observations are authored examples, separated from entered feedback. Google Fonts requires an internet connection; system-font fallbacks are configured.

## Verification

- TypeScript check and production build passed.
- Browser checked at 390 px mobile and 1440 px desktop widths; no horizontal overflow observed on inspected landing/workspace views.
- Exercised campaign creation; tester task validation and final confirmation; screenshot attachment; submission and reload persistence; review-note validation; revision request and tester resubmission; approval and persisted receipt; image restoration; multi-task back/next navigation. Tested against a clearly named local workflow-check campaign.
- Checked the tester receipt and task workspace at 390 px and invitation at 1440 px; no horizontal overflow observed.
- Development dependency scanning hit a native esbuild filesystem access limitation in the restricted Windows environment. The production build and production preview ran successfully. Normal development-server behavior outside that environment has not been verified.

## Cloud access tests

Run `npm run test:cloud` for 33 PostgreSQL checks using PGlite and stub Supabase-owned auth/storage schemas. The application migration is tested unchanged. These tests do not replace live email and Storage HTTP verification.

## Next implementation slice

Test sign-in with the project-team email, configure a sender for external testers, and run the documented two-account live verification; settle production acceptance/rejection rules; implement and test the Move reward state machine locally/testnet before a capped Sui mainnet pilot.


